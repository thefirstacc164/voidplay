'use strict';

/**
 * VOIDPLAY — test/smoke.js
 * ---------------------------------------------------------------------------
 * End-to-end smoke test (no test framework, plain Node):
 *
 *   1. MessagePack codec cross-check (client codec ⇄ msgpackr)
 *   2. Static file serving + path traversal protection
 *   3. Full 2-player Tile Collapse match over real WebSockets, framed with
 *      the CLIENT codec (so the exact browser wire path is exercised):
 *        create → join → pick → start → play → elimination → win → rematch
 *   4. Bandwidth check (< 5 KB/s per player while playing)
 *
 *   npm test
 * ---------------------------------------------------------------------------
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { Packr, Unpackr } = require('msgpackr');

const VP = require('../client/network.js');       // sets globalThis.VP, exports { net, msgpack }

const packr = new Packr({ useRecords: false, moreTypes: false });
const unpackr = new Unpackr({ useRecords: false, moreTypes: false });

const PORT = 3199;
const BASE = 'http://127.0.0.1:' + PORT;

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ FAIL: ' + label); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============================================================================
// 1. Codec cross-check
// ============================================================================

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function testCodec() {
  console.log('\n[1] MessagePack codec cross-check (client codec ⇄ msgpackr)');
  const cases = [
    0, 1, 42, 127, 128, 255, 256, 65535, 65536, 4000000,
    -1, -16, -32, -33, -128, -129, -32768, -32769,
    3.5, -2.25, 0.1,
    '', 'a', 'hello world', 'héllo ✓ voilà', 'x'.repeat(300),
    true, false, null,
    [], [1, 2, 3], [0, [1, [2, [3]]]],
    {}, { a: 1 }, { e: 'created', code: 'BOKU', you: 1 },
    { nested: { arr: [{ x: 1, y: [true, null, 'z'] }] } },
    { big: 4294967295, bigger: 4294967296, neg: -2147483648 },
  ];
  for (const v of cases) {
    // msgpackr → client decoder
    const mpBuf = new Uint8Array(packr.pack(v));
    const dec = VP.msgpack.decode(mpBuf, 0).value;
    ok(deepEqual(dec, v) || (typeof v === 'number' && Math.abs(dec - v) < 1e-12),
      'msgpackr → client decode: ' + JSON.stringify(v).slice(0, 40));
    // client encoder → msgpackr
    const myBuf = VP.msgpack.encode(v);
    const rt = unpackr.unpack(Buffer.from(myBuf));
    ok(deepEqual(rt, v) || (typeof v === 'number' && Math.abs(rt - v) < 1e-12),
      'client encode → msgpackr: ' + JSON.stringify(v).slice(0, 40));
  }
}

// ============================================================================
// Test WebSocket client (uses the CLIENT codec for framing — real e2e)
// ============================================================================

class TestClient {
  constructor(name) {
    this.name = name;
    this.ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
    this.queue = [];
    this.listeners = [];
    this.bytesIn = 0;
    this.ws.on('message', (data, isBinary) => {
      this.bytesIn += data.length;
      const u8 = new Uint8Array(data);
      const type = u8[0];
      let payload = null;
      if (u8.length > 1) payload = VP.msgpack.decode(u8, 1).value;
      const msg = { type, payload };
      for (let i = this.listeners.length - 1; i >= 0; i--) {
        if (this.listeners[i](msg)) { this.listeners.splice(i, 1); return; }
      }
      this.queue.push(msg);
    });
  }
  opened() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); }
  send(type, payload) {
    const body = VP.msgpack.encode(payload);
    const frame = Buffer.alloc(1 + body.length);
    frame[0] = type;
    Buffer.from(body).copy(frame, 1);
    this.ws.send(frame);
  }
  room(ev) { this.send(3, ev); }
  social(ev) { this.send(4, ev); }
  input(keys) { this.seq = (this.seq || 0) + 1; this.send(1, [keys, this.seq]); }
  /** wait for a message matching pred (checks the backlog first) */
  wait(type, pred, timeout) {
    pred = pred || (() => true);
    for (let i = 0; i < this.queue.length; i++) {
      const m = this.queue[i];
      if (m.type === type && pred(m.payload)) {
        return Promise.resolve(this.queue.splice(i, 1)[0].payload);
      }
    }
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout waiting for msg type ' + type)), timeout || 4000);
      this.listeners.push((m) => {
        if (m.type === type && pred(m.payload)) { clearTimeout(t); res(m.payload); return true; }
        return false;
      });
    });
  }
  close() { this.ws.close(); }
}

// tiny state merger (same logic as the browser engine)
function mergeState(merged, d, full) {
  if (full || !merged) {
    const m = { t: d.t, ph: d.ph || 0, tiles: d.tiles.slice(), p: {} };
    for (const pid in d.p) m.p[pid] = Object.assign({}, d.p[pid]);
    return m;
  }
  if (d.t !== undefined) merged.t = d.t;
  if (d.ph !== undefined) merged.ph = d.ph;
  if (d.tl) for (let i = 0; i < d.tl.length; i += 2) merged.tiles[d.tl[i]] = d.tl[i + 1];
  if (d.p) for (const pid in d.p) Object.assign(merged.p[pid] || (merged.p[pid] = {}), d.p[pid]);
  return merged;
}

// ============================================================================
// 2. HTTP checks
// ============================================================================

function httpGet(p) {
  return new Promise((res) => {
    http.get(BASE + p, (r) => {
      let body = '';
      r.on('data', (c) => (body += c));
      r.on('end', () => res({ status: r.statusCode, body }));
    }).on('error', () => res({ status: 0, body: '' }));
  });
}

async function testHttp() {
  console.log('\n[2] Static serving');
  const home = await httpGet('/');
  ok(home.status === 200 && home.body.includes('VOIDPLAY'), 'GET / serves the app (' + home.status + ')');
  const game = await httpGet('/games/tileCollapse.js');
  ok(game.status === 200 && game.body.includes('VP_GAMES'), 'GET /games/tileCollapse.js serves game code');
  const trav = await httpGet('/..%2f..%2f..%2fetc%2fpasswd');
  ok(trav.status === 403 || trav.status === 404, 'path traversal blocked (' + trav.status + ')');
  const missing = await httpGet('/nope.js');
  ok(missing.status === 404, '404 for missing files');
  const health = await httpGet('/health');
  ok(health.status === 200, '/health responds');
}

// ============================================================================
// 3-4. Full match over WebSockets
// ============================================================================

async function testMatch() {
  console.log('\n[3] Full 2-player Tile Collapse match');

  const alice = new TestClient('ALICE');
  const bob = new TestClient('BOB');
  await alice.opened(); await bob.opened();
  alice.social({ e: 'hello', name: 'ALICE' });
  bob.social({ e: 'hello', name: 'BOB' });

  // create
  alice.room({ e: 'create' });
  const created = await alice.wait(3, (p) => p.e === 'created');
  ok(/^[BCDFGHJKLMNPQRSTVWXYZ][AEIOU][BCDFGHJKLMNPQRSTVWXYZ][AEIOU]$/.test(created.code),
    'room code is CVCV consonant-vowel: ' + created.code);
  ok(created.you === 1 && created.room.players.length === 1, 'creator is player 1');
  const code = created.code;

  // join
  bob.room({ e: 'join', code });
  const joined = await bob.wait(3, (p) => p.e === 'joined');
  ok(joined.you === 2 && joined.room.players.length === 2, 'joiner is player 2, 2 players total');
  const upd = await alice.wait(3, (p) => p.e === 'update' && p.room.players.length === 2);
  ok(!!upd, 'host receives roster update');

  // bad code error
  const carol = new TestClient('CAROL');
  await carol.opened();
  carol.social({ e: 'hello', name: 'CAROL' });
  carol.room({ e: 'join', code: 'ZZZZ' });
  const err = await carol.wait(3, (p) => p.e === 'error');
  ok(!!err.msg, 'joining a bad code returns an error: "' + err.msg + '"');

  // pick + start
  alice.room({ e: 'pick', g: 'tileCollapse' });
  await alice.wait(3, (p) => p.e === 'update' && p.room.game === 'tileCollapse');
  ok(true, 'host picked tileCollapse, room updated');
  bob.room({ e: 'pick', g: 'tileCollapse' });
  const pickErr = await bob.wait(3, (p) => p.e === 'error');
  ok(/host/i.test(pickErr.msg || ''), 'non-host pick is rejected server-side: "' + pickErr.msg + '"');

  alice.room({ e: 'start' });
  const startedA = await alice.wait(3, (p) => p.e === 'started');
  const startedB = await bob.wait(3, (p) => p.e === 'started');
  ok(startedA.config && startedA.config.grid && startedA.config.grid.cols === 12, 'started event carries game CONFIG');
  ok(startedB.game === 'tileCollapse', 'both players received "started"');

  // initial full state
  const fullA = await alice.wait(2, (p) => p.f === 1);
  ok(fullA.d.tiles.length === 120 && fullA.d.p['1'] && fullA.d.p['2'], 'full state: 120 tiles + 2 players');
  await bob.wait(2, (p) => p.f === 1);

  // ---- play: ALICE idles, BOB circles a 2x2 block until the ground gives out
  const aState = mergeState(null, fullA.d, true);
  const bState = mergeState(null, fullA.d, true);
  const t0 = Date.now();
  const startBytesA = alice.bytesIn;
  let sawCrack = false, sawFall = false, sawDelta = false, ackSeen = 0;

  const drainA = setInterval(() => {
    while (alice.queue.length) {
      const m = alice.queue.shift();
      if (m.type === 2) {
        mergeState(aState, m.payload.d, m.payload.f === 1);
        if (m.payload.d.tl) {
          for (let i = 0; i < m.payload.d.tl.length; i += 2) {
            if (m.payload.d.tl[i + 1] === 1) sawCrack = true;
            if (m.payload.d.tl[i + 1] === 2) sawFall = true;
          }
        }
        if (m.payload.f === 0) sawDelta = true;
        if (m.payload.a > ackSeen) ackSeen = m.payload.a;
      }
    }
  }, 30);
  const drainB = setInterval(() => {
    while (bob.queue.length) {
      const m = bob.queue.shift();
      if (m.type === 2) mergeState(bState, m.payload.d, m.payload.f === 1);
    }
  }, 30);

  // input streams: ALICE sends nothing held; BOB circles UP→RIGHT→DOWN→LEFT
  const inputsA = setInterval(() => alice.input(0), 50);
  const CYCLE = [1, 8, 2, 4];                  // UP, RIGHT, DOWN, LEFT (bitmask)
  let step = 0;
  const inputsB = setInterval(() => { bob.input(CYCLE[step % 4]); step++; }, 160);

  const endedA = await alice.wait(3, (p) => p.e === 'ended', 15000);
  clearInterval(inputsA); clearInterval(inputsB); clearInterval(drainA); clearInterval(drainB);
  const elapsedS = (Date.now() - t0) / 1000;

  // final drain: the death delta may still be queued when 'ended' arrives
  const drainQueue = (client, merged) => {
    while (client.queue.length) {
      const m = client.queue.shift();
      if (m.type === 2) mergeState(merged, m.payload.d, m.payload.f === 1);
    }
  };
  drainQueue(alice, aState);
  drainQueue(bob, bState);

  const endedB = await bob.wait(3, (p) => p.e === 'ended');
  ok(endedA.result.w === 1 && endedA.result.reason === 'last-standing', 'ALICE (idle) wins — last one standing');
  ok(endedA.result.rank && endedA.result.rank[0] === 1 && endedA.result.rank[1] === 2, 'ranking: [1, 2]');
  ok(endedB.result.w === 1, 'both players got the result');
  ok(bState.p['2'].al === 0 && bState.p['1'].al === 1, 'client-side merged state agrees: BOB fell, ALICE alive');
  ok(sawCrack, 'tiles cracked (phase 0→1 deltas received)');
  ok(sawFall, 'tiles fell (phase 1→2 deltas received)');
  ok(sawDelta, 'delta (f=0) states received');
  ok(ackSeen > 0, 'input acks flow back (a=' + ackSeen + ')');

  // ---- bandwidth
  console.log('\n[4] Bandwidth');
  const bytesA = alice.bytesIn - startBytesA;
  const kbps = bytesA / elapsedS / 1024;
  console.log('    ALICE downloaded ' + bytesA + ' bytes in ' + elapsedS.toFixed(1) +
    's of play = ' + kbps.toFixed(2) + ' KB/s (incl. headers)');
  ok(kbps < 5, 'downstream < 5 KB/s per player while playing');

  // ---- rematch + leave
  console.log('\n[5] Rematch & teardown');
  alice.room({ e: 'again' });
  await alice.wait(3, (p) => p.e === 'started', 3000);
  await bob.wait(3, (p) => p.e === 'started', 3000);
  ok(true, 'host "again" restarts the same game');

  alice.room({ e: 'leave' });
  const left = await alice.wait(3, (p) => p.e === 'left');
  ok(!!left, 'leave confirmed');

  // room survives 30s while empty — carol can still join with the code
  carol.room({ e: 'join', code });
  const rejoined = await carol.wait(3, (p) => p.e === 'joined', 3000);
  ok(!!rejoined, 'empty room still joinable inside the 30s window');

  bob.room({ e: 'leave' });
  carol.room({ e: 'leave' });
  await sleep(150);

  // chat
  const dave = new TestClient('DAVE');
  await dave.opened();
  dave.social({ e: 'hello', name: 'DAVE' });
  dave.room({ e: 'create' });
  const dRoom = await dave.wait(3, (p) => p.e === 'created');
  carol.room({ e: 'join', code: dRoom.code });
  await carol.wait(3, (p) => p.e === 'joined');
  await sleep(100);
  dave.social({ e: 'chat', t: 'gg wp' });
  const chat = await carol.wait(4, (p) => p.e === 'chat');
  ok(chat.n === 'DAVE' && chat.t === 'gg wp', 'chat broadcasts to the room');

  // presence
  carol.social({ e: 'watch', f: ['DAVE'] });
  const pres = await carol.wait(4, (p) => p.e === 'presence');
  const daveRow = (pres.f || []).find((r) => r[0] === 'dave');
  ok(daveRow && daveRow[1] === 1 && daveRow[2] === dRoom.code, 'presence: DAVE online in room ' + dRoom.code);

  alice.close(); bob.close(); carol.close(); dave.close();
}

// ============================================================================
// Runner
// ============================================================================

async function main() {
  console.log('VOIDPLAY smoke test');
  testCodec();

  console.log('\n[boot] starting server on port ' + PORT);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write('    [server] ' + d.toString().trim() + '\n'));
  server.stderr.on('data', (d) => process.stderr.write('    [server!] ' + d.toString().trim() + '\n'));

  // wait for the server to accept connections
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(150);
    up = (await httpGet('/health')).status === 200;
  }
  if (!up) { console.error('server never came up'); server.kill('SIGKILL'); process.exit(1); }

  try {
    await testHttp();
    await testMatch();
  } catch (err) {
    failed++;
    console.error('  ✗ FAIL: unexpected error: ' + (err && err.stack || err));
  } finally {
    server.kill('SIGTERM');
  }

  console.log('\n──────────────────────────────');
  console.log((failed ? '✗ ' + failed + ' FAILED, ' : '') + '✓ ' + passed + ' passed');
  process.exit(failed ? 1 : 0);
}

main();
