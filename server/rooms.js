'use strict';

const net = require('./network');
const registry = require('./games');
const accounts = require('./accounts');
const items = require('../shared/items');
const vault = require('./vault');
const srvops = require('./ops');

const TICK_MS = 50;
const MAX_PLAYERS = 4;
const ROOM_TTL_EMPTY_MS = 30000;
const SWEEP_MS = 5000;
const MAX_CHAT_LEN = 200;
const MAX_WATCH = 100;
const TRADE_TTL_MS = 60000;
const RANK_REWARDS = [60, 30, 15, 10];
const PLAY_BONUS = 10;
const BOT_NAMES = ['Nova', 'Pixel', 'Echo', 'Byte', 'Zap', 'Fuse', 'Mint', 'Juno', 'Rex', 'Vex', 'Kilo', 'Onyx', 'Pip', 'Quill', 'Rune', 'Sage', 'Tesla', 'Umbra', 'Volt', 'Wren'];

const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const VOWELS = 'AEIOU';
const CODE_BLOCKLIST = new Set(['CACA', 'KAKA', 'FUKU', 'KUKU', 'PUPU', 'PENE', 'CULO', 'JODE']);

const rooms = new Map();

const presence = {
  online: new Map(),
  watchers: new Map(),

  register(conn, name) {
    const key = name.toLowerCase();
    if (conn.name && conn.name.toLowerCase() !== key) this.unregister(conn);
    conn.name = name;
    let set = this.online.get(key);
    if (!set) { set = new Set(); this.online.set(key, set); }
    set.add(conn);
    this.changed(key);
  },

  unregister(conn) {
    if (!conn.name) return;
    const key = conn.name.toLowerCase();
    const set = this.online.get(key);
    if (set) { set.delete(conn); if (!set.size) this.online.delete(key); }
    this.unwatchAll(conn);
    this.changed(key);
  },

  watch(conn, names) {
    if (!Array.isArray(names)) return;
    for (const raw of names.slice(0, MAX_WATCH)) {
      const key = String(raw || '').trim().toLowerCase();
      if (!key || key.length > 32) continue;
      let set = this.watchers.get(key);
      if (!set) { set = new Set(); this.watchers.set(key, set); }
      set.add(conn);
    }
    this.sendPresence(conn);
  },

  unwatchAll(conn) {
    for (const [key, set] of this.watchers) {
      if (set.delete(conn) && !set.size) this.watchers.delete(key);
    }
  },

  changed(key) {
    const set = this.watchers.get(key);
    if (!set) return;
    for (const conn of set) this.sendPresence(conn);
  },

  sendPresence(conn) {
    const list = [];
    for (const [key, set] of this.watchers) {
      if (!set.has(conn)) continue;
      const online = this.online.get(key);
      let roomCode = null;
      if (online && online.size) {
        for (const c of online) { roomCode = c.room ? c.room.code : null; break; }
      }
      list.push([key, online ? 1 : 0, roomCode]);
    }
    net.send(conn.ws, net.MSG.SOCIAL, { e: 'presence', f: list });
  },

  roomChanged(conn) {
    if (conn.name) this.changed(conn.name.toLowerCase());
  },

  findConns(name) {
    const key = String(name || '').trim().toLowerCase();
    return key ? [...(this.online.get(key) || [])] : [];
  },
};

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.bots = new Map();
    this.hostPid = null;
    this.gameType = null;
    this.gameState = null;
    this.lastSent = null;
    this.tickInterval = null;
    this.phase = 'lobby';
    this.emptySince = null;
    this.created = Date.now();
    this.trades = new Map();
  }

  totalPlayers() {
    return this.players.size + this.bots.size;
  }

  usedSlots() {
    const used = new Set(this.players.keys());
    for (const s of this.bots.keys()) used.add(s);
    return used;
  }

  roster() {
    const out = [];
    for (const c of this.players.values()) {
      const user = accounts.profileOf(c);
      out.push({
        i: c.pid,
        n: c.name,
        s: c.pid,
        sh: user ? user.shape : 'sq',
        tr: user ? user.trail : 't0',
        bot: 0,
      });
    }
    for (const b of this.bots.values()) {
      out.push({ i: b.slot, n: b.name, s: b.slot, sh: b.sh, tr: b.tr, bot: 1 });
    }
    out.sort((a, b) => a.s - b.s);
    return out;
  }

  snapshot() {
    return { code: this.code, host: this.hostPid, game: this.gameType, phase: this.phase, players: this.roster() };
  }

  broadcast(type, payload) {
    for (const c of this.players.values()) net.send(c.ws, type, payload);
  }

  updateAll() {
    this.broadcast(net.MSG.ROOM, { e: 'update', room: this.snapshot() });
  }

  add(conn) {
    if (this.totalPlayers() >= MAX_PLAYERS) return 'Room is full';
    if (this.phase === 'playing') return 'Game in progress, try again in a moment';
    const used = this.usedSlots();
    let slot = 1;
    while (used.has(slot)) slot++;
    conn.pid = slot;
    conn.room = this;
    conn.lastSeq = 0;
    this.players.set(slot, conn);
    this.emptySince = null;
    if (this.hostPid === null) this.hostPid = slot;
    presence.roomChanged(conn);
    return null;
  }

  remove(conn) {
    if (conn.room !== this) return;
    const pid = conn.pid;
    this.players.delete(pid);
    conn.room = null;
    conn.pid = null;
    for (const [key, tr] of this.trades) {
      if (tr.fromPid === pid || tr.toPid === pid) this.trades.delete(key);
    }
    if (!this.players.size) {
      this.stopGame();
      this.phase = 'lobby';
      this.hostPid = null;
      this.emptySince = Date.now();
    } else {
      if (this.hostPid === pid) this.hostPid = Math.min(...this.players.keys());
      if (this.phase === 'playing' && this.gameState) {
        const game = registry.registry[this.gameType];
        if (game.onPlayerLeft) game.onPlayerLeft(this.gameState, pid);
        this.sendFullState();
        const win = game.checkWin(this.gameState);
        if (win) this.endGame(win);
      }
      this.updateAll();
    }
    presence.roomChanged(conn);
  }

  pick(conn, gameId) {
    if (conn.pid !== this.hostPid) return 'Only the host picks the game';
    if (this.phase === 'playing') return 'Game in progress';
    if (!registry.registry[gameId]) return 'Unknown game';
    this.gameType = gameId;
    this.updateAll();
    return null;
  }

  botadd(conn) {
    if (conn.pid !== this.hostPid) return 'Only the host can add bots';
    if (this.phase === 'playing') return 'Game in progress';
    if (this.totalPlayers() >= MAX_PLAYERS) return 'Room is full';
    const used = this.usedSlots();
    let slot = 1;
    while (used.has(slot)) slot++;
    const taken = new Set(this.roster().map((r) => r.n));
    const pool = BOT_NAMES.filter((n) => !taken.has('BOT ' + n));
    const name = 'BOT ' + (pool.length ? pool[(Math.random() * pool.length) | 0] : slot);
    const shapes = items.SHAPES;
    const sh = shapes[(Math.random() * shapes.length) | 0].id;
    this.bots.set(slot, { slot: slot, name: name, sh: sh, tr: 't0' });
    this.updateAll();
    return null;
  }

  botdel(conn) {
    if (conn.pid !== this.hostPid) return 'Only the host can remove bots';
    if (this.phase === 'playing') return 'Game in progress';
    if (!this.bots.size) return 'No bots in the room';
    const highest = Math.max(...this.bots.keys());
    this.bots.delete(highest);
    this.updateAll();
    return null;
  }

  start(conn) {
    if (conn.pid !== this.hostPid) return 'Only the host can start';
    if (this.phase === 'playing') return 'Game in progress';
    const game = registry.registry[this.gameType];
    if (!game) return 'Pick a game first';
    if (this.totalPlayers() < game.CONFIG.minPlayers) {
      return 'Need at least ' + game.CONFIG.minPlayers + ' players, add a bot';
    }
    this.phase = 'playing';
    this.gameState = game.init(this.roster());
    this.lastSent = null;
    for (const [key, tr] of this.trades) this.trades.delete(key);
    this.broadcast(net.MSG.ROOM, {
      e: 'started', game: this.gameType, config: game.CONFIG, room: this.snapshot(),
    });
    this.sendFullState();
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
    return null;
  }

  tick() {
    const game = registry.registry[this.gameType];
    if (!game || !this.gameState) { this.stopGame(); return; }
    try {
      const opConns = srvops.activeConns(this.players);
      const anyFreeze = opConns.some((c) => c.ops.freeze);
      srvops.preBots(this.gameState, opConns);
      game.bots(this.gameState);
      srvops.postBots(this.gameState, opConns, anyFreeze);
      game.tick(this.gameState, TICK_MS);
      srvops.afterTick(this.gameState, game, this.gameType, opConns, TICK_MS, (pid, k) => {
        game.onInput(this.gameState, pid, { k });
      });
      let win = srvops.forcedWin(this.gameState, opConns);
      if (!win) {
        srvops.revive(this.gameState, game, opConns);
        win = game.checkWin(this.gameState);
      }
      this.sendDeltaState();
      if (win) this.endGame(win);
    } catch (err) {
      console.error('[voidplay] game error in room ' + this.code + ':', err);
      this.endGame({ w: null, reason: 'error', rank: this.roster().map((r) => r.i) });
    }
  }

  sendDeltaState() {
    const game = registry.registry[this.gameType];
    const delta = game.getState(this.gameState, this.lastSent);
    if (delta) {
      for (const c of this.players.values()) {
        net.send(c.ws, net.MSG.STATE, { a: c.lastSeq, f: 0, d: delta });
      }
      this.lastSent = JSON.parse(JSON.stringify(this.gameState));
    }
  }

  sendFullState() {
    const game = registry.registry[this.gameType];
    if (!game || !this.gameState) return;
    const full = game.getState(this.gameState, null);
    for (const c of this.players.values()) {
      net.send(c.ws, net.MSG.STATE, { a: c.lastSeq, f: 1, d: full });
    }
    this.lastSent = JSON.parse(JSON.stringify(this.gameState));
  }

  endGame(result) {
    this.stopGame();
    this.phase = 'results';
    for (const c of this.players.values()) {
      const pos = Array.isArray(result.rank) ? result.rank.indexOf(c.pid) : -1;
      const base = RANK_REWARDS[pos] !== undefined ? RANK_REWARDS[pos] : 10;
      const msg = accounts.credit(c, base + PLAY_BONUS, pos === 0);
      if (msg) net.send(c.ws, net.MSG.SOCIAL, msg);
    }
    this.broadcast(net.MSG.ROOM, { e: 'ended', result, room: this.snapshot() });
  }

  stopGame() {
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
  }

  toLobby(conn) {
    if (conn.pid !== this.hostPid) return 'Only the host can do that';
    if (this.phase === 'playing') return 'Game in progress';
    this.stopGame();
    this.phase = 'lobby';
    this.gameState = null;
    this.lastSent = null;
    this.updateAll();
    return null;
  }

  routeInput(conn, keys) {
    if (this.phase !== 'playing' || !this.gameState) return;
    const game = registry.registry[this.gameType];
    if (game) game.onInput(this.gameState, conn.pid, { k: keys });
  }
}

function generateCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < 2; i++) {
      code += CONSONANTS[(Math.random() * CONSONANTS.length) | 0];
      code += VOWELS[(Math.random() * VOWELS.length) | 0];
    }
    if (!CODE_BLOCKLIST.has(code) && !rooms.has(code)) return code;
  }
  let code;
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince > ROOM_TTL_EMPTY_MS) {
      room.stopGame();
      rooms.delete(code);
    }
  }
}, SWEEP_MS).unref();

function create(conn) {
  if (conn.room) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Leave your current room first' });
  const room = new Room(generateCode());
  rooms.set(room.code, room);
  const err = room.add(conn);
  if (err) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
  net.send(conn.ws, net.MSG.ROOM, { e: 'created', code: room.code, you: conn.pid, room: room.snapshot() });
  presence.roomChanged(conn);
}

function join(conn, rawCode) {
  if (conn.room) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Leave your current room first' });
  const code = String(rawCode || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'No room ' + code + ', check the code' });
  const err = room.add(conn);
  if (err) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
  net.send(conn.ws, net.MSG.ROOM, { e: 'joined', code: room.code, you: conn.pid, room: room.snapshot() });
  room.updateAll();
  presence.roomChanged(conn);
}

function leave(conn) {
  if (!conn.room) return;
  const room = conn.room;
  room.remove(conn);
  net.send(conn.ws, net.MSG.ROOM, { e: 'left' });
}

function routeInput(conn, keys) {
  if (conn.room) conn.room.routeInput(conn, keys);
}

function chat(conn, rawText) {
  const text = String(rawText || '').slice(0, MAX_CHAT_LEN).trim();
  if (!text || !conn.room || !conn.name) return;
  const now = Date.now();
  conn.chatTimes = (conn.chatTimes || []).filter((t) => now - t < 5000);
  if (conn.chatTimes.length >= 5) return;
  conn.chatTimes.push(now);
  conn.room.broadcast(net.MSG.SOCIAL, { e: 'chat', i: conn.pid, n: conn.name, t: text });
}

function invite(conn, rawName, game) {
  if (!conn.room) return;
  const targets = presence.findConns(rawName).filter((c) => c !== conn);
  if (!targets.length) return net.send(conn.ws, net.MSG.SOCIAL, { e: 'error', msg: 'That player is not online' });
  for (const c of targets) {
    net.send(c.ws, net.MSG.SOCIAL, {
      e: 'invite', from: conn.name, code: conn.room.code, game: conn.room.gameType || game || null,
    });
  }
}

function trade(conn, payload) {
  if (!conn.room || !conn.auth) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Log in to trade' });
  const user = accounts.profileOf(conn);
  if (!user) return;
  const give = normOffer(payload && payload.give, user);
  const want = normOffer(payload && payload.want, null);
  if (!give || !want) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Pick both sides of the trade' });
  const toKey = String((payload && payload.to) || '').trim().toLowerCase();
  let target = null;
  for (const c of conn.room.players.values()) {
    if (c !== conn && c.auth && c.auth === toKey) { target = c; break; }
  }
  if (!target) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'That player is not in this room' });
  conn.room.trades.set(conn.auth, { fromPid: conn.pid, toPid: target.pid, from: conn.auth, to: toKey, give: give, want: want, ts: Date.now() });
  net.send(target.ws, net.MSG.ROOM, { e: 'trade', from: conn.name, fromPid: conn.pid, give: give, want: want });
}

function normOffer(offer, user) {
  if (!offer) return null;
  const kind = offer.k === 'trail' ? 'trail' : 'shape';
  const id = String(offer.id || '');
  if (!items.find(kind, id)) return null;
  const key = (kind === 'trail' ? 't:' : 's:') + id;
  if (user && !user.items.includes(key)) return null;
  if (!user && (id === 'sq' || id === 't0')) return null;
  return { k: kind, id: id };
}

function tradeok(conn) {
  const room = conn.room;
  if (!room || !conn.auth) return;
  for (const [key, tr] of room.trades) {
    if (tr.to !== conn.auth) continue;
    if (Date.now() - tr.ts > TRADE_TTL_MS) { room.trades.delete(key); return; }
    const giver = vault.get().users[tr.from];
    const taker = vault.get().users[conn.auth];
    if (!giver || !taker) { room.trades.delete(key); return; }
    const giveKey = tr.give.k === 'trail' ? 't:' + tr.give.id : 's:' + tr.give.id;
    const wantKey = tr.want.k === 'trail' ? 't:' + tr.want.id : 's:' + tr.want.id;
    if (!giver.items.includes(giveKey)) { room.trades.delete(key); return; }
    if (tr.want.id !== 'sq' && tr.want.id !== 't0' && !taker.items.includes(wantKey)) { room.trades.delete(key); return; }
    vault.mutate((d) => {
      const g = d.users[tr.from];
      const t = d.users[conn.auth];
      g.items = g.items.filter((x) => x !== giveKey);
      if (tr.want.id !== 'sq' && tr.want.id !== 't0' && !g.items.includes(wantKey)) g.items.push(wantKey);
      if (tr.give.k === 'shape' && g.shape === tr.give.id) g.shape = 'sq';
      if (tr.give.k === 'trail' && g.trail === tr.give.id) g.trail = 't0';
      t.items = t.items.filter((x) => x !== wantKey);
      if (!t.items.includes(giveKey)) t.items.push(giveKey);
      if (tr.want.k === 'shape' && t.shape === tr.want.id) t.shape = 'sq';
      if (tr.want.k === 'trail' && t.trail === tr.want.id) t.trail = 't0';
      g.updated = Date.now();
      t.updated = Date.now();
    });
    room.trades.delete(key);
    const giverConn = room.players.get(tr.fromPid);
    if (giverConn) {
      const gu = accounts.profileOf(giverConn);
      net.send(giverConn.ws, net.MSG.SOCIAL, { e: 'profile', profile: accounts.publicProfile(gu) });
    }
    const tu = accounts.profileOf(conn);
    net.send(conn.ws, net.MSG.SOCIAL, { e: 'profile', profile: accounts.publicProfile(tu) });
    net.send(conn.ws, net.MSG.ROOM, { e: 'traded' });
    if (giverConn) net.send(giverConn.ws, net.MSG.ROOM, { e: 'traded' });
    return;
  }
}

function tradeno(conn) {
  const room = conn.room;
  if (!room) return;
  for (const [key, tr] of room.trades) {
    if (tr.to !== (conn.auth || conn.name.toLowerCase())) continue;
    room.trades.delete(key);
    const giverConn = room.players.get(tr.fromPid);
    if (giverConn) net.send(giverConn.ws, net.MSG.ROOM, { e: 'tradeno' });
    return;
  }
}

function watch(conn, names) {
  presence.watch(conn, names);
}

function onDisconnect(conn) {
  if (conn.room) conn.room.remove(conn);
  presence.unregister(conn);
}

function dispatch(conn, event, payload) {
  if (!payload || typeof event !== 'string') return;
  switch (event) {
    case 'create': create(conn); break;
    case 'join': join(conn, payload.code); break;
    case 'leave': leave(conn); break;
    case 'pick': {
      if (conn.room) {
        const err = conn.room.pick(conn, String(payload.g || ''));
        if (err) net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
      }
      break;
    }
    case 'start': {
      if (conn.room) {
        const err = conn.room.start(conn);
        if (err) net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
      }
      break;
    }
    case 'again': {
      if (conn.room && conn.room.phase === 'results') {
        const err = conn.room.start(conn);
        if (err) net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
      }
      break;
    }
    case 'lobby': {
      if (conn.room) {
        const err = conn.room.toLobby(conn);
        if (err) net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
      }
      break;
    }
    case 'botadd': {
      if (conn.room) {
        const err = conn.room.botadd(conn);
        if (err) net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
      }
      break;
    }
    case 'botdel': {
      if (conn.room) {
        const err = conn.room.botdel(conn);
        if (err) net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
      }
      break;
    }
    case 'trade': trade(conn, payload); break;
    case 'tradeok': tradeok(conn); break;
    case 'tradeno': tradeno(conn); break;
    default: break;
  }
}

module.exports = {
  rooms,
  generateCode,
  create,
  join,
  leave,
  routeInput,
  chat,
  invite,
  watch,
  onDisconnect,
  dispatch,
  presence,
  MAX_PLAYERS,
  TICK_MS,
};
