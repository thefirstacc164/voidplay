(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['colorRaid'])
    || require('./colorRaid.ai.js');
  var COLS = 16, ROWS = 12, CELL_W = 46, CELL_H = 40, OFF_X = 32, OFF_Y = 60;
  var SPAWNS = [[1, 1], [14, 1], [1, 10], [14, 10]];

  var CONFIG = {
    id: 'colorRaid', name: 'Color Raid', icon: '🎨',
    duration: 75, minPlayers: 2, maxPlayers: 4,
    description: 'Race across the grid and paint it yours. Every tile you step on turns your color.',
    instructions: 'Hop with WASD / Arrows. Most tiles in your color when time runs out wins.',
    world: { w: 800, h: 600 }
  };

  var HOP = {
    cols: COLS, rows: ROWS, cellW: CELL_W, cellH: CELL_H, offX: OFF_X, offY: OFF_Y, moveMs: 140,
    canEnter: function () { return true; },
    onLand: function (st, p) {
      var i = p.gy * COLS + p.gx;
      st.tiles[i] = p.pid;
      S.fx('tile', { i: i, ph: p.pid });
    }
  };

  function cx(gx) { return OFF_X + (gx + 0.5) * CELL_W; }
  function cy(gy) { return OFF_Y + (gy + 0.5) * CELL_H; }

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, tiles: new Array(COLS * ROWS).fill(0), p: {}, cntT: 0 };
    players.forEach(function (r) {
      var sp = SPAWNS[(r.s - 1) % 4];
      var pid = r.i;
      st.p[String(pid)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: cx(sp[0]), y: cy(sp[1]), gx: sp[0], gy: sp[1], d: -1, m: 0, ms: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0, pid: pid, mem: {}
      };
      st.tiles[sp[1] * COLS + sp[0]] = pid;
    });
    return st;
  }

  function onInput(st, pid, input) {
    var p = st.p[String(pid)];
    if (p && p.al) S.latch(p, input.k);
  }

  function onPlayerLeft(st, pid) {
    var p = st.p[String(pid)];
    if (p && p.al) { p.al = 0; p.deathT = st.t; }
  }

  function recount(st) {
    var cnt = {};
    for (var k in st.p) cnt[k] = 0;
    for (var i = 0; i < st.tiles.length; i++) {
      var o = st.tiles[i];
      if (o && cnt[String(o)] !== undefined) cnt[String(o)]++;
    }
    for (var key in st.p) st.p[key].sc = cnt[key] || 0;
  }

  function tick(st, dt) {
    st.t += dt;
    st.cntT += dt;
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.hopStep(st, p, HOP);
      S.endInput(p);
    }
    if (st.cntT >= 400) { st.cntT = 0; recount(st); }
  }

  function checkWin(st) {
    if (st.t < CONFIG.duration * 1000) return null;
    recount(st);
    var rank = S.rank(st, 'sc');
    var sc = {};
    for (var k in st.p) sc[k] = st.p[k].sc;
    return { w: rank[0], reason: 'time', rank: rank, sc: sc };
  }

  var PF = ['x', 'y', 'gx', 'gy', 'd', 'm', 'al', 'sc'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: 0, tiles: st.tiles.slice(), p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    var tl = [];
    for (var i = 0; i < st.tiles.length; i++) if (st.tiles[i] !== last.tiles[i]) tl.push(i, st.tiles[i]);
    if (tl.length) d.tl = tl;
    var pd = {};
    for (var key in st.p) {
      var f = S.pd(st.p[key], last.p[key], PF);
      if (f) pd[key] = f;
    }
    if (Object.keys(pd).length) d.p = pd;
    return d;
  }

function bots(st) {
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.bot || !p.al) continue;
    if (p.m) continue;
      if (p.skill === undefined) {
        var srr = Math.random();
        p.skill = srr < 0.5 ? 3 : srr < 0.8 ? 4 : srr < 0.93 ? 5 : srr < 0.985 ? 6 : 7;
      }
      var sk = Math.max(1, Math.min(10, p.skill || 4));
      var d = AI.think(st, p, sk);
      if (!d) { p.aim = null; continue; }
      p.aim = d.aim !== undefined ? d.aim : null;
      if (d.k) S.latch(p, d.k);
      if (d.tap) p.tp |= 16;
      if (d.tp !== undefined) p.tp = d.tp;
    }
  }

  function render(ctx, view, meId) {
    for (var i = 0; i < view.tiles.length; i++) {
      var owner = view.tiles[i];
      var x = OFF_X + (i % COLS) * CELL_W + 3;
      var y = OFF_Y + ((i / COLS) | 0) * CELL_H + 3;
      if (owner) {
        var color = S.COLORS[(view.players[String(owner)] ? view.players[String(owner)].slot : owner) - 1] || '#888';
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.22;
        S.rrect(ctx, x, y, CELL_W - 6, CELL_H - 6, 4);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        S.rrect(ctx, x, y, CELL_W - 6, CELL_H - 6, 4);
        ctx.stroke();
      }
    }

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 12, color);
      S.text(ctx, p.name + ' ' + (p.sc || 0), p.x, p.y - 24, { size: 10, glow: color, blur: 6 });
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
