(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var COLS = 40, ROWS = 30, CELL = 20, RADIUS = 27;
  var SPAWNS = [[120, 300], [680, 300], [400, 120], [400, 480]];

  var CONFIG = {
    id: 'pixelPaint', name: 'Pixel Paint', icon: '🖌️',
    duration: 90, minPlayers: 2, maxPlayers: 4,
    description: 'Free-roam splatter war. Paint the floor your color and steal theirs.',
    instructions: 'Move with WASD / Arrows. Everything you touch turns your color. Most coverage wins.',
    world: { w: 800, h: 600 }
  };

  var PHYS = { speed: 250, friction: 5 };

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, tiles: new Array(COLS * ROWS).fill(0), p: {}, cntT: 0 };
    players.forEach(function (r, i) {
      var sp = SPAWNS[(r.s - 1) % 4];
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: sp[0], y: sp[1], vx: 0, vy: 0, fx: 1, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0, mem: { tx: sp[0], ty: sp[1] }
      };
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

  function paint(st, p) {
    var pid = p.pidCache || (p.pidCache = Number(pidKey(st, p)));
    var minX = Math.max(0, ((p.x - RADIUS) / CELL) | 0);
    var maxX = Math.min(COLS - 1, ((p.x + RADIUS) / CELL) | 0);
    var minY = Math.max(0, ((p.y - RADIUS) / CELL) | 0);
    var maxY = Math.min(ROWS - 1, ((p.y + RADIUS) / CELL) | 0);
    var cx0 = ((p.x / CELL) | 0) * CELL + CELL / 2;
    var cy0 = ((p.y / CELL) | 0) * CELL + CELL / 2;
    for (var gy = minY; gy <= maxY; gy++) {
      for (var gx = minX; gx <= maxX; gx++) {
        var px0 = gx * CELL + CELL / 2, py0 = gy * CELL + CELL / 2;
        if ((px0 - p.x) * (px0 - p.x) + (py0 - p.y) * (py0 - p.y) <= RADIUS * RADIUS) {
          var i = gy * COLS + gx;
          if (st.tiles[i] !== pid) st.tiles[i] = pid;
        }
      }
    }
  }

  function pidKey(st, p) { for (var k in st.p) if (st.p[k] === p) return k; return '0'; }

  function recount(st) {
    var cnt = {};
    for (var k in st.p) cnt[k] = 0;
    for (var i = 0; i < st.tiles.length; i++) {
      var o = st.tiles[i];
      if (o && cnt[String(o)] !== undefined) cnt[String(o)]++;
    }
    for (var key in st.p) st.p[key].sc = Math.round(cnt[key] / (COLS * ROWS) * 100);
  }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    st.cntT += dt;
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.drive(p, d, PHYS);
      S.wallsRect(p, 800, 600, 12, 0.4);
      paint(st, p);
      S.endInput(p);
    }
    if (st.cntT >= 500) { st.cntT = 0; recount(st); }
  }

  function checkWin(st) {
    if (st.t < CONFIG.duration * 1000) return null;
    recount(st);
    var rank = S.rank(st, 'sc');
    var sc = {};
    for (var k in st.p) sc[k] = st.p[k].sc;
    return { w: rank[0], reason: 'time', rank: rank, sc: sc };
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc'];

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
      var pid = Number(k);
      if (S.dist(p.x, p.y, p.mem.tx, p.mem.ty) < 40 || Math.random() < 0.003) {
        var tries = 0, best = null, bestCount = -1;
        while (tries++ < 14) {
          var gx = (Math.random() * COLS) | 0, gy = (Math.random() * ROWS) | 0;
          var count = 0;
          for (var dy = -2; dy <= 2; dy++) {
            for (var dx = -2; dx <= 2; dx++) {
              var nx = gx + dx, ny = gy + dy;
              if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
              if (st.tiles[ny * COLS + nx] !== pid) count++;
            }
          }
          if (count > bestCount) {
            bestCount = count;
            best = { x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 };
          }
        }
        p.mem.tx = best.x;
        p.mem.ty = best.y;
      }
      var dx = p.mem.tx - p.x, dy = p.mem.ty - p.y;
      var l = Math.hypot(dx, dy) || 1;
      p.aim = { x: dx / l, y: dy / l };
    }
  }

  function render(ctx, view, meId) {
    for (var i = 0; i < view.tiles.length; i++) {
      var owner = view.tiles[i];
      if (!owner) continue;
      var gx = i % COLS, gy = (i / COLS) | 0;
      var pl = view.players[String(owner)];
      var color = pl ? S.COLORS[(pl.slot - 1) % 4] : '#666';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(gx * CELL, gy * CELL, CELL, CELL);
    }
    ctx.globalAlpha = 1;

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, RADIUS, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
      S.shape(ctx, p.x, p.y, p.sh, 12, color);
      S.text(ctx, p.name + ' ' + (p.sc || 0) + '%', p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
