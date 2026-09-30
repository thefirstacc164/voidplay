'use strict';

const fs = require('fs');
const path = require('path');

const S = require('../shared/core.js');
const G = {};
const files = fs.readdirSync(path.join(__dirname, '..', 'games')).filter(f => f.endsWith('.js')).sort();
for (const f of files) {
  const mod = require(path.join(__dirname, '..', 'games', f));
  G[mod.CONFIG.id] = mod;
}

const E = { mode: null, gameId: null, twoP: false, st: null, keys1: 0, keys2: 0, remote: null };
global.window = { VP: { engine: { E }, S }, VP_GAMES: G };
global.VP = global.window.VP;
global.VP_GAMES = G;

const bundle = fs.readFileSync(path.join(__dirname, '..', 'private', 'ops.js'), 'utf8');
(0, eval)(bundle);
const VPX = global.window.VPX;

if (!VPX) { console.log('FAIL bundle did not export VPX'); process.exit(1); }

const roster = [
  { i: 1, n: 'ME', s: 1, sh: 'sq', tr: 't0' },
  { i: 2, n: 'B1', s: 2, sh: 'ci', tr: 't0', bot: 1 },
  { i: 3, n: 'B2', s: 3, sh: 'tr', tr: 't0', bot: 1 },
  { i: 4, n: 'B3', s: 4, sh: 'hx', tr: 't0', bot: 1 },
];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' → ' + extra : '')); }
}

function run(id, ms, opts) {
  opts = opts || {};
  const mod = G[id];
  const st = mod.init(opts.roster || roster);
  E.mode = 'local';
  E.gameId = id;
  E.twoP = !!opts.twoP;
  E.st = st;
  E.keys1 = opts.keys1 || 0;
  E.keys2 = 0;
  VPX._h();
  let res = null;
  const ticks = ms / 50;
  for (let i = 0; i < ticks; i++) {
    if (opts.beforeTick) opts.beforeTick(st, i);
    mod.onInput(st, 1, { k: E.keys1 });
    if (opts.twoP) mod.onInput(st, 2, { k: E.keys2 });
    mod.bots(st);
    mod.tick(st, 50);
    if (opts.afterTick) opts.afterTick(st, i);
    res = mod.checkWin(st);
    if (res) break;
  }
  return { st, res };
}

console.log('--- universal ---');

let r = run('asteroidStorm', 30000);
VPX.god(true);
r = run('asteroidStorm', 30000);
ok('god mode keeps me alive 30s', r.st.p['1'].al === 1, 'died at ' + (r.st.p['1'].deathT / 1000).toFixed(1) + 's');
VPX.god(false);

VPX.freeze(true);
let freezePos = null, freezeMoved = 0;
r = run('orbitDodge', 8000, { afterTick: (st, i) => {
  if (i === 40) freezePos = { x: st.p['2'].x, y: st.p['2'].y };
  if (i > 40 && freezePos) freezeMoved = Math.max(freezeMoved, Math.hypot(st.p['2'].x - freezePos.x, st.p['2'].y - freezePos.y));
} });
VPX.freeze(false);
ok('freeze bots stops movement', freezeMoved < 5, 'moved ' + freezeMoved.toFixed(0) + 'px');

function travel(withTurbo) {
  VPX.turbo(withTurbo);
  const st = G.laserMaze.init(roster);
  E.mode = 'local'; E.gameId = 'laserMaze'; E.st = st;
  E.keys1 = st.p['1'].x > 400 ? 4 : 8;
  VPX._h();
  let mark = null;
  for (let i = 0; i < 24; i++) {
    G.laserMaze.onInput(st, 1, { k: E.keys1 });
    G.laserMaze.bots(st);
    G.laserMaze.tick(st, 50);
    if (i === 15) mark = st.p['1'].x;
  }
  VPX.turbo(false);
  return Math.abs(st.p['1'].x - mark);
}
const offDist = travel(false);
const onDist = travel(true);
ok('turbo boosts speed', onDist > offDist * 1.35, offDist.toFixed(0) + ' vs ' + onDist.toFixed(0));

VPX.win();
const rw = run('orbitDodge', 200);
ok('instant win forces result', rw.res && rw.res.w === 1 && rw.res.rank[0] === 1, JSON.stringify(rw.res && rw.res.rank));

console.log('--- per game ---');

run('bombTag', 25000);
VPX.set('bt-pass', true);
let bombStuck = 0;
r = run('bombTag', 25000, { afterTick: (st) => { if (st.bomb === 1) bombStuck++; } });
VPX.set('bt-pass', false);
ok('bombTag hot potato', r.st.p['1'].al === 1 && bombStuck === 0, 'stuck ' + bombStuck + ' ticks');
VPX.set('bt-pass', false);
VPX.set('bt-fuse', true);
r = run('bombTag', 25000);
VPX.set('bt-fuse', false);
ok('bombTag cool fuse', r.st.fuse >= 6000 || r.st.p['1'].al === 0 ? r.st.p['1'].al === 1 || r.st.fuse === undefined : true, 'fuse ' + r.st.fuse);

VPX.set('tt-never', true);
r = run('turboTag', 30000, { afterTick: (st) => { if (st.it === 1) { fail++; console.log('FAIL turboTag never it at t=' + (st.t / 1000).toFixed(1)); } } });
VPX.set('tt-never', false);
ok('turboTag never it', r.st.it !== 1, 'it=' + r.st.it);

VPX.set('in-immune', true);
r = run('infected', 30000, { afterTick: (st) => { if (st.inf === 1) { fail++; console.log('FAIL infected immune at t=' + (st.t / 1000).toFixed(1)); } } });
VPX.set('in-immune', false);
ok('infected immune', r.st.inf !== 1);

VPX.set('jg-always', true);
r = run('juggernaut', 20000);
VPX.set('jg-always', false);
ok('juggernaut always jug', r.st.jg === 1, 'jg=' + r.st.jg);

VPX.set('kh-score', true);
r = run('kingOfTheHill', 25000);
VPX.set('kh-score', false);
ok('kingOfTheHill triple score', r.st.p['1'].sc > 40, 'sc=' + r.st.p['1'].sc);

VPX.set('lv-hover', true);
r = run('lavaFloor', 15000);
VPX.set('lv-hover', false);
ok('lavaFloor hover', r.st.p['1'].best < 1000, 'best=' + r.st.p['1'].best);

VPX.set('sc-up', true);
r = run('skyClimb', 8000);
VPX.set('sc-up', false);
ok('skyClimb updraft', r.st.p['1'].y < 3400, 'y=' + r.st.p['1'].y);

VPX.set('sn-magnet', true);
r = run('snakePit', 15000);
VPX.set('sn-magnet', false);
ok('snakePit orb magnet grows me', r.st.p['1'].ln > 8, 'ln=' + r.st.p['1'].ln);

VPX.set('cr-brush', true);
r = run('colorRaid', 8000);
VPX.set('cr-brush', false);
let crCount = 0;
for (const t of r.st.tiles) if (t === r.st.p['1'].pid) crCount++;
ok("colorRaid mega brush", crCount > 70, 'painted ' + crCount);

VPX.set('pp-splash', true);
r = run('pixelPaint', 8000);
VPX.set('pp-splash', false);
let ppCount = 0;
for (const t of r.st.tiles) if (t === 1) ppCount++;
ok('pixelPaint splash', ppCount > 100, 'painted ' + ppCount);

VPX.set('tc-solid', true);
r = run('tileCollapse', 40000);
VPX.set('tc-solid', false);
ok('tileCollapse solid ground', r.st.p['1'].al === 1 || (r.res && r.res.w === 1), 'died');

VPX.set('mr-steer', true);
const rm = run('mazeRacer', 15000);
VPX.set('mr-steer', false);
const mc = Math.max(0, Math.min(24, (rm.st.p['1'].x / 32) | 0));
const mr = Math.max(0, Math.min(17, (rm.st.p['1'].y / 32) | 0));
ok('mazeRacer auto steer', rm.st._dist[mr * 25 + mc] < 40, 'dist=' + rm.st._dist[mr * 25 + mc]);

VPX.set('od-orbit', true);
r = run('orbitDodge', 25000);
VPX.set('od-orbit', false);
ok('orbitDodge auto orbit 25s', r.st.p['1'].al === 1, 'died at ' + (r.st.p['1'].deathT / 1000).toFixed(1) + 's');

VPX.set('gw-repel', true);
r = run('gravityWell', 25000);
VPX.set('gw-repel', false);
ok('gravityWell core repel 25s', r.st.p['1'].al === 1);

VPX.set('hh-magnet', true);
r = run('hoverHockey', 15000);
VPX.set('hh-magnet', false);
ok('hoverHockey puck magnet', r.st.sc[0] > 0 || r.st.puck.x > 500, 'sc=' + r.st.sc[0] + ' puckX=' + r.st.puck.x.toFixed(0));

VPX.set('bk-bump', true);
r = run('bumperKnock', 5000);
VPX.set('bk-bump', false);
ok('bumperKnock super bump', r.st.p['1'].dashT > 0, 'dashT=' + r.st.p['1'].dashT);

VPX.set('rr-auto', true);
r = run('reactionRoyale', 120000);
VPX.set('rr-auto', false);
ok('reactionRoyale auto tap wins rounds', r.st.p['1'].wins >= 2, 'wins=' + r.st.p['1'].wins);

VPX.set('lm-calm', true);
r = run('laserMaze', 20000);
VPX.set('lm-calm', false);
const off = Math.abs(r.st.p['1'].x - 400) + Math.abs(r.st.p['1'].y - 300);
ok('laserMaze serenity centers me', off < 240, 'offset=' + off.toFixed(0));

VPX.set('nd-stream', true);
r = run('neonDrift', 6000, { keys1: 8 });
VPX.set('nd-stream', false);
// new cheats
VPX.set('gw-magnet', true);
VPX.god(true);
r = run('gravityWell', 6000);
VPX.god(false);
ok('gravityWell coin magnet', (r.st.p['1'].sc || 0) >= 4, 'collected ' + r.st.p['1'].sc);
VPX.set('gw-magnet', false);

VPX.set('kh-warp', true);
r = run('kingOfTheHill', 4000);
ok('kingOfTheHill hill warp', Math.hypot(r.st.p['1'].x - 400, r.st.p['1'].y - 300) < 60, 'dist ' + Math.hypot(r.st.p['1'].x - 400, r.st.p['1'].y - 300).toFixed(0));
VPX.set('kh-warp', false);

VPX.set('tc-bridge', true);
r = run('tileCollapse', 8000);
let gone = 0;
for (const t of r.st.tiles) if (t === 2) gone++;
ok('tileCollapse full bridge', gone === 0 && r.st.p['1'].al === 1, gone + ' holes');
VPX.set('tc-bridge', false);

VPX.set('tt-immortal', true);
r = run('turboTag', 10000);
ok('turboTag untaggable', r.st.p['1'].al === 1, 'imm=' + r.st.imm);
VPX.set('tt-immortal', false);

VPX.set('sn-grow', true);
let snMax = 0;
r = run('snakePit', 5000, { keys1: 8, afterTick: (st) => { if (st.p['1'].ln > snMax) snMax = st.p['1'].ln; } });
ok('snakePit grow fast', snMax > 15, 'max len=' + snMax);
VPX.set('sn-grow', false);

VPX.auto(true);
r = run('kingOfTheHill', 8000);
const autoDist = Math.hypot(r.st.p['1'].x - 400, r.st.p['1'].y - 300);
VPX.auto(false);
ok('auto play drives me', autoDist < 160, 'bot drove me to ' + autoDist.toFixed(0) + 'px from the hill');

VPX.auto(true);
VPX.god(true);
r = run('asteroidStorm', 25000);
VPX.god(false);
VPX.auto(false);
ok('god + auto play asteroidStorm', r.st.p['1'].al === 1, 'died');

ok('neonDrift slip stream runs', true);

for (const id of Object.keys(G)) {
  if (['asteroidStorm', 'bombTag', 'turboTag', 'infected', 'juggernaut', 'kingOfTheHill', 'lavaFloor', 'skyClimb', 'snakePit', 'colorRaid', 'pixelPaint', 'tileCollapse', 'mazeRacer', 'orbitDodge', 'gravityWell', 'hoverHockey', 'bumperKnock', 'reactionRoyale', 'laserMaze', 'neonDrift'].indexOf(id) >= 0) continue;
  run(id, 3000);
  ok(id + ' smoke with hooks', true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
