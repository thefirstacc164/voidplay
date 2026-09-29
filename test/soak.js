'use strict';

const path = require('path');
const S = require('../shared/core.js');

const BOT_NAMES = ['NOVA', 'ECHO', 'RIFT', 'ONYX', 'VEX', 'LUCA', 'MIRA', 'ZED'];
const SHAPES = ['sq', 'ci', 'tr', 'hx', 'dm', 'st'];

function fakeCtx() {
  const props = {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 800, height: 600 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (typeof k === 'string' && !(k in props)) props[k] = (...a) => undefined;
      return props[k];
    },
    set(t, k, v) { props[k] = v; return true; }
  });
}

function runGame(id, opts) {
  opts = opts || {};
  const mod = require(path.join(__dirname, '..', 'games', id + '.js'));
  const roster = [];
  const n = opts.humans === undefined ? 1 : opts.humans;
  for (let i = 1; i <= 4; i++) {
    roster.push({
      i, n: i <= n ? 'HUMAN' + i : 'BOT_' + BOT_NAMES[i],
      s: i, sh: SHAPES[i % SHAPES.length], tr: 't' + (i % 5), bot: i > n
    });
  }
  const st = mod.init(roster);
  const dt = 50;
  const maxT = (opts.maxSec || (mod.CONFIG.duration + 30)) * 1000;
  let result = null;
  let ticks = 0;
  while (st.t < maxT) {
    try {
      mod.bots(st);
      for (const k in st.p) {
        const p = st.p[k];
        if (!p.bot && p.al && opts.input) opts.input(st, p, k);
      }
      mod.tick(st, dt);
      for (const k in st.p) if (mod.getState) break;
      ticks++;
      result = mod.checkWin(st);
      if (result) break;
    } catch (err) {
      return { id, error: 'tick ' + ticks + ': ' + err.stack };
    }
  }

  if (!result) return { id, error: 'never ended after ' + Math.round(st.t / 1000) + 's' };
  if (!Array.isArray(result.rank) || result.rank.length !== 4) return { id, error: 'bad rank: ' + JSON.stringify(result.rank) };
  if (result.w !== null && !st.p[String(result.w)]) return { id, error: 'winner not a player' };

  const last = null;
  const full = mod.getState(st, last);
  if (!full || !full.p) return { id, error: 'bad full state' };
  const lastSent = JSON.parse(JSON.stringify(st));
  const d1 = mod.getState(st, lastSent);
  const d2 = mod.getState(st, JSON.parse(JSON.stringify(st)));
  if (d2 && Object.keys(d2).length > 1) {
    return { id, error: 'delta with no changes should be near-empty, got ' + JSON.stringify(Object.keys(d2)) };
  }

  S.fx.set(() => {});
  const view = {
    t: st.t, ph: st.ph || 0, now: 12345, seed: st.seed,
    tiles: full.tiles || [], en: full.en || {},
    players: {}, anim: { deaths: {}, tiles: {} }, s: { bodies: {} }
  };
  for (const k in st.p) {
    const p = st.p[k];
    view.players[k] = Object.assign({}, p, { name: p.name, slot: p.slot, sh: p.sh, tr: p.tr, al: p.al });
    if (!p.al) view.anim.deaths[k] = 12345;
  }
  try {
    mod.render(fakeCtx(), view, 1);
  } catch (err) {
    return { id, error: 'render: ' + err.stack };
  }

  return { id, ok: true, reason: result.reason, winner: result.w, simSec: Math.round(st.t / 1000), ticks };
}

const games = process.argv.slice(2);
const list = games.length ? games : ['tileCollapse'];
let fail = 0;
for (const id of list) {
  const r = runGame(id);
  if (r.error) { fail++; console.log('FAIL ' + id + ' → ' + r.error); }
  else console.log('ok   ' + id.padEnd(16) + ' ended=' + r.simSec + 's reason=' + r.reason + ' winner=' + r.winner);
}
process.exit(fail ? 1 : 0);
