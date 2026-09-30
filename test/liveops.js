'use strict';

// Live-path ops test: the REAL client bundle (private/ops.js) driven through the
// REAL client network module (client/network.js) against the REAL server.
// This is the same code path a browser hits: F9 panel toggles -> net.send SOCIAL
// -> server key check -> server-side application -> opsack.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

const PORT = 10117;
const KEY = process.env.PSWRD_PSWRD || 'test123';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' -> ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(port, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 10000)) {
    const oky = await new Promise((r) => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); r(true); });
      s.on('error', () => r(false));
    });
    if (oky) return true;
    await sleep(150);
  }
  return false;
}

async function main() {
  // --- boot the real server ---
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), PSWRD_PSWRD: KEY }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  const up = await waitForPort(PORT);
  if (!up) { console.log('FAIL server did not start'); process.exit(1); }

  // --- browser shim ---
  const E = { mode: null, gameId: null, twoP: false, st: null, keys1: 0, keys2: 0, remote: null };
  globalThis.window = globalThis;
  globalThis.location = { protocol: 'http:', host: '127.0.0.1:' + PORT };
  globalThis.VP = { engine: { E }, S: require('../shared/core.js') };
  globalThis.VP_GAMES = {};
  globalThis.VPXK = KEY;

  // real client network module (sets globalThis.VP.net + VP.msgpack)
  require('../client/network.js');

  // the real ops bundle, unlocked with the real key
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'private', 'ops.js'), 'utf8');
  (0, eval)(bundle);
  const VPX = globalThis.VPX;
  ok('bundle exports VPX', !!VPX);
  ok('bundle captured the key', VPX && VPX.info().adm === true);

  const realNet = globalThis.VP.net;
  ok('real net module in place', !!(realNet && typeof realNet.send === 'function' && typeof realNet.on === 'function'));

  // --- wire the room protocol through the real net ---
  const events = [];
  const states = [];
  let roomPid = null;
  realNet.on(3, (msg) => { events.push(msg); });
  realNet.on(2, (msg) => { states.push(msg); });

  const waitEvent = (name, timeoutMs) => new Promise((resolve) => {
    const from = events.length;
    const t0 = Date.now();
    const tick = () => {
      for (let i = from; i < events.length; i++) if (events[i] && events[i].e === name) return resolve(events[i]);
      if (Date.now() - t0 > (timeoutMs || 5000)) return resolve(null);
      setTimeout(tick, 40);
    };
    tick();
  });

  const opened = new Promise((r) => realNet.on('open', r));
  realNet.connect();
  await opened;
  ok('real websocket connected', true);

  realNet.send(3, { e: 'create' });
  const created = await waitEvent('created');
  ok('room created through real net', !!(created && created.you === 1), JSON.stringify(created && created.e));
  roomPid = created && created.you;

  realNet.send(3, { e: 'botadd' });
  realNet.send(3, { e: 'botadd' });
  await sleep(300);
  realNet.send(3, { e: 'pick', g: 'bombTag' });
  await sleep(200);
  realNet.send(3, { e: 'start' });
  const started = await waitEvent('started');
  ok('online game started', !!(started && started.game === 'bombTag'));

  // this is what VP.engine.startRemote does when a room game begins:
  E.mode = 'remote';
  E.gameId = 'bombTag';
  ok('panel sees online mode', VPX.info().mode === 'remote');

  // --- wrong key through the real net is ignored ---
  realNet.send(4, { e: 'ops', k: 'definitely-not-it', o: { god: true } });
  await sleep(600);
  ok('wrong key gets no ack', VPX.info().srv.god !== true);

  // --- god mode mid-game through the REAL panel path ---
  VPX.god(true);
  let acked = false;
  for (let i = 0; i < 40 && !acked; i++) { await sleep(100); acked = VPX.info().srv.god === true; }
  ok('god mode acked by server (real path)', acked);

  await sleep(5000);
  const seen = [...states].reverse().find((s) => s && s.d && s.d.p && s.d.p['1'] && s.d.p['1'].al !== undefined);
  ok('god keeps me alive online (real path)', !!(seen && seen.d.p['1'].al === 1), seen ? 'al=' + seen.d.p['1'].al : 'no state');

  // --- auto play mid-game through the REAL panel path ---
  VPX.auto(true);
  let autoAck = false;
  for (let i = 0; i < 40 && !autoAck; i++) { await sleep(100); autoAck = VPX.info().srv.auto === true; }
  ok('auto play acked by server (real path)', autoAck);

  // --- instant win mid-game through the REAL panel path ---
  VPX.win();
  const ended = await waitEvent('ended', 10000);
  ok('instant win ends the online game (real path)', !!(ended && ended.result && ended.result.w === roomPid),
    ended && ended.result ? 'w=' + ended.result.w : 'no end');

  // --- per-game assist on the server: hockey perfect keeper ---
  realNet.send(3, { e: 'pick', g: 'hoverHockey' });
  await sleep(250);
  realNet.send(3, { e: 'start' });
  const started2 = await waitEvent('started');
  ok('hockey game started', !!(started2 && started2.game === 'hoverHockey'));
  E.gameId = 'hoverHockey';
  const hockeyFrom = states.length;

  VPX.set('hh-keeper', true);
  let actAck = false;
  for (let i = 0; i < 40 && !actAck; i++) { await sleep(100); actAck = VPX.info().srv.act['hh-keeper'] === true; }
  ok('perfect keeper acked by server (real path)', actAck);

  await sleep(4000);
  const kx = [];
  for (let si = hockeyFrom; si < states.length; si++) {
    const p = states[si] && states[si].d && states[si].d.p && states[si].d.p['1'];
    if (p && p.x !== undefined) kx.push(p.x);
  }
  const nearLine = kx.filter((x) => x < 95).length;
  ok('server keeper holds the goal line (real path)', kx.length > 0 && nearLine / kx.length > 0.9,
    kx.length + ' samples, ' + nearLine + ' at line');

  VPX.win();
  const ended2 = await waitEvent('ended', 10000);
  ok('second instant win lands', !!(ended2 && ended2.result && ended2.result.w === roomPid));

  // --- teardown ---
  try { realNet.close(); } catch (e) {}
  server.kill('SIGTERM');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error('liveops crashed:', err); process.exit(1); });
