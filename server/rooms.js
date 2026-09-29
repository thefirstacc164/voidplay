'use strict';

/**
 * VOIDPLAY — server/rooms.js
 * ---------------------------------------------------------------------------
 * Room manager: creation, joining, 4-letter codes, lifecycle, game loops.
 *
 *   Room flow:  LOBBY → PLAYING → RESULTS → LOBBY …
 *   Room stores: players[], gameType, gameState, tickInterval.
 *
 *   * Max 4 players per room; player id == color slot (1..4).
 *   * Server is authoritative: while PLAYING a 20 Hz (50 ms) interval runs
 *     the current game's tick(), checks for a winner and broadcasts a
 *     delta-compressed state snapshot to every player.
 *   * Rooms auto-destroy 30 seconds after becoming empty (brief
 *     disconnects can rejoin with the same code inside that window).
 *   * Friend presence: connections can "watch" usernames and receive
 *     online/offline/room updates (friend lists live in the client's
 *     localStorage — the server only tracks live sessions).
 * ---------------------------------------------------------------------------
 */

const net = require('./network');
const registry = require('./games');

const TICK_MS = 50;                    // 20 Hz server tick
const MAX_PLAYERS = 4;
const ROOM_TTL_EMPTY_MS = 30_000;      // auto-destroy after 30s empty
const SWEEP_MS = 5_000;
const MAX_CHAT_LEN = 200;
const MAX_WATCH = 100;

// CVCV consonant-vowel codes: readable, spellable over voice, no ambiguous
// digits. Small blocklist so the generator never hands out something rude.
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const VOWELS = 'AEIOU';
const CODE_BLOCKLIST = new Set(['CACA', 'KAKA', 'FUKU', 'KUKU', 'PUPU', 'PENE', 'CULO', 'JODE']);

const rooms = new Map();               // code → Room

// ============================================================================
// Presence (friend online status)
// ============================================================================

const presence = {
  online: new Map(),   // lowerName → Set<conn>
  watchers: new Map(), // lowerName → Set<conn>

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

  /** Push a snapshot of everything this connection is watching. */
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
};

// ============================================================================
// Room
// ============================================================================

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();          // pid (1-4) → conn
    this.hostPid = null;
    this.gameType = null;
    this.gameState = null;
    this.lastSent = null;              // snapshot the clients currently have
    this.tickInterval = null;
    this.phase = 'lobby';              // lobby | playing | results
    this.emptySince = null;
    this.created = Date.now();
  }

  roster() {
    return [...this.players.values()]
      .sort((a, b) => a.pid - b.pid)
      .map((c) => ({ i: c.pid, n: c.name, s: c.slot }));
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

  sendTo(conn, type, payload) {
    net.send(conn.ws, type, payload);
  }

  // -- membership ------------------------------------------------------------

  add(conn) {
    if (this.players.size >= MAX_PLAYERS) return 'Room is full';
    if (this.phase === 'playing') return 'Game in progress — try again in a moment';
    const used = new Set([...this.players.values()].map((c) => c.slot));
    let slot = 1;
    while (used.has(slot)) slot++;
    conn.pid = slot;                   // pid == slot == color index
    conn.slot = slot;
    conn.room = this;
    conn.lastSeq = 0;
    this.players.set(slot, conn);
    this.emptySince = null;
    if (this.hostPid === null) this.hostPid = slot;
    presence.roomChanged(conn);
    return null;                       // no error
  }

  remove(conn) {
    if (conn.room !== this) return;
    const pid = conn.pid;
    this.players.delete(pid);
    conn.room = null;
    conn.pid = null;
    if (!this.players.size) {
      this.stopGame();
      this.phase = 'lobby';
      this.hostPid = null;
      this.emptySince = Date.now();
    } else {
      if (this.hostPid === pid) this.hostPid = Math.min(...this.players.keys());
      if (this.phase === 'playing' && this.gameState) {
        const game = registry[this.gameType];
        if (game.onPlayerLeft) game.onPlayerLeft(this.gameState, pid);
        this.sendFullState();          // resync everyone after the roster change
        const win = game.checkWin(this.gameState);
        if (win) this.endGame(win);
      }
      this.updateAll();
    }
    presence.roomChanged(conn);
  }

  // -- game flow ---------------------------------------------------------------

  pick(conn, gameId) {
    if (conn.pid !== this.hostPid) return 'Only the host picks the game';
    if (this.phase === 'playing') return 'Game in progress';
    if (!registry[gameId]) return 'Unknown game';
    this.gameType = gameId;
    this.updateAll();
    return null;
  }

  start(conn) {
    if (conn.pid !== this.hostPid) return 'Only the host can start';
    if (this.phase === 'playing') return 'Game in progress';
    const game = registry[this.gameType];
    if (!game) return 'Pick a game first';
    if (this.players.size < game.CONFIG.minPlayers) {
      return `Need at least ${game.CONFIG.minPlayers} players`;
    }
    this.phase = 'playing';
    this.gameState = game.init(this.roster());
    this.lastSent = null;
    this.broadcast(net.MSG.ROOM, {
      e: 'started', game: this.gameType, config: game.CONFIG, room: this.snapshot(),
    });
    this.sendFullState();
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
    return null;
  }

  tick() {
    const game = registry[this.gameType];
    if (!game || !this.gameState) { this.stopGame(); return; }
    try {
      game.tick(this.gameState, TICK_MS);
      const win = game.checkWin(this.gameState);
      this.sendDeltaState();        // final delta goes out BEFORE 'ended' so
      if (win) this.endGame(win);   // clients see the winning elimination
    } catch (err) {
      console.error(`[voidplay] game error in room ${this.code}:`, err);
      this.endGame({ w: null, reason: 'error', rank: this.roster().map((r) => r.i) });
    }
  }

  /** One delta computed per tick, personalised ack per player. */
  sendDeltaState() {
    const game = registry[this.gameType];
    const delta = game.getState(this.gameState, this.lastSent);
    if (delta) {
      for (const c of this.players.values()) {
        net.send(c.ws, net.MSG.STATE, { a: c.lastSeq, f: 0, d: delta });
      }
      this.lastSent = JSON.parse(JSON.stringify(this.gameState));
    }
  }

  sendFullState() {
    const game = registry[this.gameType];
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
    const game = registry[this.gameType];
    if (game) game.onInput(this.gameState, conn.pid, { k: keys });
  }
}

// ============================================================================
// Code generation & lifecycle
// ============================================================================

function generateCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < 2; i++) {
      code += CONSONANTS[(Math.random() * CONSONANTS.length) | 0];
      code += VOWELS[(Math.random() * VOWELS.length) | 0];
    }
    if (!CODE_BLOCKLIST.has(code) && !rooms.has(code)) return code;
  }
  // astronomically unlikely; fall back to a collision-checked random code
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
      console.log(`[voidplay] room ${code} destroyed (empty 30s)`);
    }
  }
}, SWEEP_MS).unref();

// ============================================================================
// Public API (called from server/index.js)
// ============================================================================

function hello(conn, rawName) {
  const name = String(rawName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  if (!name) {
    net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Pick a username first' });
    return;
  }
  presence.register(conn, name);
}

function create(conn) {
  if (!conn.name) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Pick a username first' });
  if (conn.room) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Leave your current room first' });
  const room = new Room(generateCode());
  rooms.set(room.code, room);
  const err = room.add(conn);
  if (err) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
  console.log(`[voidplay] ${conn.name} created room ${room.code}`);
  net.send(conn.ws, net.MSG.ROOM, { e: 'created', code: room.code, you: conn.pid, room: room.snapshot() });
  presence.roomChanged(conn);
}

function join(conn, rawCode) {
  if (!conn.name) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Pick a username first' });
  if (conn.room) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: 'Leave your current room first' });
  const code = String(rawCode || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: `No room "${code}" — check the code` });
  const err = room.add(conn);
  if (err) return net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
  console.log(`[voidplay] ${conn.name} joined room ${room.code}`);
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
  // light rate limit: 5 messages per rolling window
  const now = Date.now();
  conn.chatTimes = (conn.chatTimes || []).filter((t) => now - t < 5000);
  if (conn.chatTimes.length >= 5) return;
  conn.chatTimes.push(now);
  conn.room.broadcast(net.MSG.SOCIAL, { e: 'chat', i: conn.pid, n: conn.name, t: text });
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
    case 'again': {                       // results → rematch with same game
      if (conn.room && conn.room.phase === 'results') {
        const err = conn.room.start(conn);
        if (err) net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
      }
      break;
    }
    case 'lobby': {                       // results → back to room lobby
      if (conn.room) {
        const err = conn.room.toLobby(conn);
        if (err) net.send(conn.ws, net.MSG.ROOM, { e: 'error', msg: err });
      }
      break;
    }
    default: break;
  }
}

module.exports = {
  rooms,
  generateCode,
  hello,
  create,
  join,
  leave,
  routeInput,
  chat,
  watch,
  onDisconnect,
  dispatch,
  MAX_PLAYERS,
  TICK_MS,
};
