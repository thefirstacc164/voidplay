'use strict';

const http = require('http');
const { Packr, Unpackr } = require('msgpackr');
const WebSocket = require('ws');

const packr = new Packr({ useRecords: false, moreTypes: false });
const unpackr = new Unpackr({ useRecords: false, moreTypes: false });

const RUN = String(Date.now() % 100000);
const NAME_A = 'Smoke' + RUN + 'a';
const NAME_B = 'Smoke' + RUN + 'b';
const NAME_C = 'Smoke' + RUN + 'c';
const BASE = 'http://127.0.0.1:' + (parseInt(process.env.PORT, 10) || 10000);
const WS_BASE = 'ws://127.0.0.1:' + (parseInt(process.env.PORT, 10) || 10000);
const MSG = { INPUT: 1, STATE: 2, ROOM: 3, SOCIAL: 4 };

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

function section(name) {
  console.log('\n' + name);
}

function get(path, headers) {
  return new Promise((resolve) => {
    const req = http.get(BASE + path, { headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }));
  });
}

function post(path, body) {
  return new Promise((resolve) => {
    const req = http.request(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }));
    req.end(body);
  });
}

class Client {
  constructor(label) {
    this.label = label;
    this.ws = new WebSocket(WS_BASE);
    this.events = [];
    this.states = [];
    this.open = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (data) => {
      const type = data[0];
      let payload = null;
      if (data.length > 1) payload = unpackr.unpack(data.subarray(1));
      if (type === MSG.STATE) this.states.push(payload);
      else this.events.push(payload);
    });
  }
  send(type, payload) {
    this.ws.send(Buffer.concat([Buffer.from([type]), packr.pack(payload)]));
  }
  room(e, extra) { this.send(MSG.ROOM, Object.assign({ e }, extra || {})); }
  social(e, extra) { this.send(MSG.SOCIAL, Object.assign({ e }, extra || {})); }
  waitEvent(name, timeoutMs) {
    const started = Date.now();
    const from = this.events.length;
    return new Promise((resolve) => {
      const tick = () => {
        for (let i = from; i < this.events.length; i++) {
          if (this.events[i] && this.events[i].e === name) return resolve(this.events[i]);
        }
        if (Date.now() - started > (timeoutMs || 3000)) return resolve(null);
        setTimeout(tick, 40);
      };
      tick();
    });
  }
  close() {
    try { this.ws.close(); } catch (err) {}
  }
}

function unzip(body) {
  return require('zlib').gunzipSync(body).toString('utf8');
}

async function main() {
  section('static files');
  const gamesJson = await get('/games.json');
  ok(gamesJson.status === 200, 'GET /games.json → 200');
  const manifest = JSON.parse(gamesJson.body.toString());
  ok(manifest.games && manifest.games.length === 20, 'manifest lists 20 games');
  ok(manifest.v !== undefined, 'manifest has asset version');
  ok(gamesJson.headers['cache-control'] === 'no-cache', 'games.json is no-cache');

  const index = await get('/');
  ok(index.status === 200 && index.body.toString().includes('Made with love by Step'), 'index serves with footer credit');
  ok(index.body.toString().includes('btn-play'), 'index has PLAY button');
  ok(!/username/i.test(index.body.toString()), 'no username prompt');

  const probe = await post('/x/ops', JSON.stringify({ k: 'not-the-key' }));
  ok(probe.status === 405, 'maintenance route answers bad keys like any other path');
  const admBad = await post('/x/adm', JSON.stringify({ k: 'not-the-key', op: 'list' }));
  ok(admBad.status === 405, 'second maintenance route answers bad keys the same way');

  const gz = await get('/shared/core.js?v=1', { 'Accept-Encoding': 'gzip' });
  ok(gz.status === 200 && gz.headers['content-encoding'] === 'gzip', 'shared/core.js gzipped');
  ok(gz.headers['cache-control'] === 'public, max-age=31536000, immutable', 'versioned asset is immutable');
  const plain = await get('/shared/core.js');
  ok(plain.status === 200 && !plain.headers['content-encoding'], 'shared/core.js without gzip header is plain');
  const etag = plain.headers.etag;
  const cached = await get('/shared/core.js', { 'If-None-Match': etag });
  ok(cached.status === 304, 'ETag revalidation → 304');

  const game = await get('/games/snakePit.js?v=1', { 'Accept-Encoding': 'gzip' });
  ok(game.status === 200 && game.headers['content-encoding'] === 'gzip', 'game file gzipped');
  const noVersion = await get('/games/snakePit.js');
  ok(noVersion.headers['cache-control'] === 'no-cache', 'game file without ?v is no-cache');
  const missing = await get('/games/nope.js');
  ok(missing.status === 404, 'missing game → 404');
  const escape = await get('/games/../server/index.js');
  ok(escape.status === 404, 'path traversal blocked');
  const health = await get('/health');
  ok(health.status === 200 && health.body.toString() === 'ok', 'health endpoint');

  section('registry');
  const registry = require('../server/games.js');
  ok(Object.keys(registry.registry).length === 20, '20 modules in registry');
  let contractBad = [];
  for (const id of Object.keys(registry.registry)) {
    const m = registry.registry[id];
    const fns = ['init', 'onInput', 'onPlayerLeft', 'tick', 'checkWin', 'getState', 'bots', 'render']
      .every((f) => typeof m[f] === 'function');
    const cfg = m.CONFIG && typeof m.CONFIG.id === 'string' && m.CONFIG.duration > 0;
    if (!fns || !cfg) contractBad.push(id);
  }
  ok(contractBad.length === 0, 'module contract holds for every game' + (contractBad.length ? ' (bad: ' + contractBad.join(',') + ')' : ''));

  section('websocket session');
  const a = new Client('A');
  await a.open;
  const hello = await a.waitEvent('hello');
  ok(!!hello && /^Guest-\d{4}$/.test(hello.name), 'guest gets a random Guest-XXXX name');

  a.social('signup', { n: NAME_A, p: 'secret123' });
  let auth = await a.waitEvent('auth');
  ok(auth && auth.ok === 1 && auth.profile && auth.profile.coins === 100, 'signup works, 100 starting coins');
  ok(typeof auth.token === 'string' && auth.token.includes('.'), 'signup returns session token');
  const token = auth.token;

  a.social('login', { n: NAME_A, p: 'wrongpass' });
  auth = await a.waitEvent('auth');
  ok(auth && auth.ok === 0, 'wrong password rejected');

  for (let i = 0; i < 6; i++) {
    a.social('login', { token });
    auth = await a.waitEvent('auth');
  }
  ok(auth && auth.ok === 1, 'session token relogin is never rate limited');

  a.social('claim', { c: 9999 });
  const claim = await a.waitEvent('claim');
  ok(claim && claim.ok === 1 && claim.added === 400, 'guest coin claim capped at 400');

  a.social('buy', { k: 'shape', id: 'ci' });
  const buy = await a.waitEvent('buy');
  ok(buy && buy.ok === 1 && buy.profile.items.includes('s:ci'), 'buy shape works');
  a.social('equip', { k: 'shape', id: 'ci' });
  const equip = await a.waitEvent('equip');
  ok(equip && equip.ok === 1 && equip.profile.shape === 'ci', 'equip works');
  a.social('buy', { k: 'shape', id: 'st' });
  const tooPoor = await a.waitEvent('buy');
  ok(tooPoor && tooPoor.ok === 0, 'cannot afford rejected');

  const b = new Client('B');
  await b.open;
  b.social('signup', { n: NAME_B, p: 'friend123' });
  const bAuth = await b.waitEvent('auth');
  ok(bAuth && bAuth.ok === 1, 'second account created');

  a.social('fadd', { n: NAME_B });
  const fadd = await a.waitEvent('friends');
  ok(fadd && fadd.ok === 1 && fadd.profile.friends.includes(NAME_B.toLowerCase()), 'friend add works');
  a.social('watch', { f: [NAME_B.toLowerCase()] });
  const presence = await a.waitEvent('presence');
  ok(!!presence && Array.isArray(presence.f), 'presence watch works');

  section('player admin');
  const KEY = process.env.PSWRD_PSWRD;
  if (KEY) {
    const c = new Client('C');
    await c.open;
    c.social('signup', { n: NAME_C, p: 'target123' });
    const cAuth = await c.waitEvent('auth');
    ok(cAuth && cAuth.ok === 1, 'third account created');
    const admList = await post('/x/adm', JSON.stringify({ k: KEY, op: 'list' }));
    const lst = admList.status === 200 ? JSON.parse(admList.body.toString()) : null;
    ok(lst && lst.ok === 1 && lst.users.some((u) => u.n === NAME_C), 'admin list sees accounts');
    const admRen = await post('/x/adm', JSON.stringify({ k: KEY, op: 'ren', f: NAME_C, t: NAME_C + 'x' }));
    ok(admRen.status === 200 && JSON.parse(admRen.body.toString()).ok === 1, 'admin rename works');
    c.social('logout', {});
    await new Promise((r) => setTimeout(r, 100));
    c.social('login', { n: NAME_C + 'x', p: 'target123' });
    const relog = await c.waitEvent('auth');
    ok(relog && relog.ok === 1, 'renamed account logs in with its new name');
    const admCoins = await post('/x/adm', JSON.stringify({ k: KEY, op: 'coins', n: NAME_C + 'x', v: 500 }));
    ok(admCoins.status === 200 && JSON.parse(admCoins.body.toString()).ok === 1, 'admin sets coins');
    const admPass = await post('/x/adm', JSON.stringify({ k: KEY, op: 'pass', n: NAME_C + 'x', np: 'newpass9' }));
    ok(admPass.status === 200 && JSON.parse(admPass.body.toString()).ok === 1, 'admin resets password');
    c.social('login', { n: NAME_C + 'x', p: 'newpass9' });
    const relog2 = await c.waitEvent('auth');
    ok(relog2 && relog2.ok === 1, 'reset password logs in');
    const admBan = await post('/x/adm', JSON.stringify({ k: KEY, op: 'ban', n: NAME_C + 'x', on: 1 }));
    ok(admBan.status === 200 && JSON.parse(admBan.body.toString()).ok === 1, 'admin bans account');
    const d = new Client('D');
    await d.open;
    d.social('login', { n: NAME_C + 'x', p: 'newpass9' });
    const banLogin = await d.waitEvent('auth');
    ok(banLogin && banLogin.ok === 0 && /banned/i.test(banLogin.msg || ''), 'banned account cannot log in');
    d.close();
    const admUnban = await post('/x/adm', JSON.stringify({ k: KEY, op: 'ban', n: NAME_C + 'x', on: 0 }));
    ok(admUnban.status === 200 && JSON.parse(admUnban.body.toString()).ok === 1, 'admin unbans account');
    const lst3 = await post('/x/adm', JSON.stringify({ k: KEY, op: 'list' }));
    const lu = JSON.parse(lst3.body.toString());
    ok(lu.users.every((x) => typeof x.b === 'number' && x.cr > 0), 'list carries ban flag and creation date');
    const admDel = await post('/x/adm', JSON.stringify({ k: KEY, op: 'del', n: NAME_C + 'x' }));
    ok(admDel.status === 200 && JSON.parse(admDel.body.toString()).ok === 1, 'admin deletes account');
    const admList2 = await post('/x/adm', JSON.stringify({ k: KEY, op: 'list' }));
    const lst2 = JSON.parse(admList2.body.toString());
    ok(!lst2.users.some((u) => u.n === NAME_C + 'x'), 'deleted account is gone from the list');
    c.close();
  } else {
    ok(true, 'player admin needs PSWRD_PSWRD, skipped');
  }

  section('rooms');
  a.room('create');
  const created = await a.waitEvent('created');
  ok(created && created.you === 1 && created.room.players.length === 1, 'room created, host pid 1');
  ok(created.room.players[0].sh === 'ci', 'roster carries equipped cosmetics');
  const code = created.code;

  b.room('join', { code });
  const joined = await b.waitEvent('joined');
  ok(joined && joined.you === 2, 'second player joins as pid 2');

  a.room('botadd');
  await new Promise((r) => setTimeout(r, 150));
  a.room('botadd');
  await new Promise((r) => setTimeout(r, 150));
  const botRoom = a.events.filter((e) => e && e.e === 'update').pop();
  ok(botRoom && botRoom.room.players.length === 4, 'two bots fill the room');
  ok(botRoom.room.players.filter((p) => p.bot).length === 2, 'bots flagged in roster');

  a.room('botdel');
  await new Promise((r) => setTimeout(r, 150));
  a.room('botdel');
  await new Promise((r) => setTimeout(r, 150));

  a.room('pick', { g: 'unknown-game' });
  const badPick = await a.waitEvent('error');
  ok(badPick && /unknown/i.test(badPick.msg), 'unknown game rejected');

  a.room('pick', { g: 'orbitDodge' });
  await new Promise((r) => setTimeout(r, 150));
  a.room('start');
  const started = await a.waitEvent('started');
  ok(started && started.game === 'orbitDodge' && started.config, 'game starts with config');

  const fullState = a.states.find((s) => s && s.f);
  ok(!!fullState && fullState.d && fullState.d.p, 'full state snapshot arrives');

  const inputTimer = setInterval(() => {
    a.send(MSG.INPUT, [16, 1]);
    b.send(MSG.INPUT, [4, 1]);
  }, 60);
  const ended = await a.waitEvent('ended', 30000);
  clearInterval(inputTimer);
  ok(!!ended && ended.result && Array.isArray(ended.result.rank), 'game ends with a ranking');
  const reward = a.events.find((e) => e && e.e === 'reward');
  ok(!!reward && reward.coins > 0, 'winner reward credited');
  const rewardB = b.events.find((e) => e && e.e === 'reward');
  ok(!!rewardB && rewardB.coins > 0, 'loser reward credited');

  section('chat, trades, invites');
  a.social('chat', { t: 'gg wp' });
  const chatB = await b.waitEvent('chat');
  ok(chatB && chatB.t === 'gg wp', 'chat delivered to room');

  b.social('claim', { c: 300 });
  await b.waitEvent('claim');
  b.social('buy', { k: 'trail', id: 't1' });
  await b.waitEvent('buy');
  a.room('trade', { to: NAME_B, give: { k: 'shape', id: 'ci' }, want: { k: 'trail', id: 't1' } });
  const offer = await b.waitEvent('trade');
  ok(!!offer && offer.give.id === 'ci' && offer.want.id === 't1', 'trade offer forwarded');
  b.room('tradeok');
  const traded = await a.waitEvent('traded');
  ok(!!traded, 'trade completes');
  const aProfile = a.events.filter((e) => e && e.e === 'profile').pop();
  ok(aProfile && aProfile.profile.items.includes('t:t1') && !aProfile.profile.items.includes('s:ci'), 'trade swapped items');

  a.room('create');
  await new Promise((r) => setTimeout(r, 150));
  a.social('invite', { to: NAME_B });
  const invite = await b.waitEvent('invite');
  ok(!!invite && invite.from === NAME_A && invite.code, 'invite forwarded with room code');

  a.social('logout');
  const logout = await a.waitEvent('logout');
  ok(logout && logout.ok === 1 && /^Guest-\d{4}$/.test(logout.guest), 'logout returns to guest');

  a.social('login', { token });
  const reauth = await a.waitEvent('auth');
  ok(reauth && reauth.ok === 1 && reauth.name === NAME_A, 'token re-login works');

  a.close();
  b.close();

  section('delta compression');
  const registry2 = require('../server/games.js');
  const mod = registry2.registry.bumperKnock;
  const roster = [1, 2, 3, 4].map((i) => ({ i, n: 'P' + i, s: i, sh: 'sq', tr: 't0', bot: true }));
  const st = mod.init(roster);
  const full = mod.getState(st, null);
  const clone = JSON.parse(JSON.stringify(st));
  const delta = mod.getState(st, clone);
  ok(delta && Object.keys(delta).length <= 1, 'unchanged state → near-empty delta');
  mod.bots(st);
  mod.tick(st, 50);
  const delta2 = mod.getState(st, clone);
  ok(delta2 && delta2.p && Object.keys(delta2.p).length <= 4, 'one tick → small per-player delta');
  ok(full.p && full.p['1'].name === 'P1', 'full snapshot has names');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(1);
});
