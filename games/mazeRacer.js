(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var COLS = 25, ROWS = 18, CELL = 32;
  var W = COLS * CELL, H = ROWS * CELL;
  var GOAL = { c: COLS - 1, r: 0 };
  var PHYS = { speed: 300, friction: 5, r: 10, w: W };

  var CONFIG = {
    id: 'mazeRacer', name: 'Maze Racer', icon: '🌀',
    duration: 90, minPlayers: 2, maxPlayers: 4,
    description: 'A procedural neon maze. Find the exit in the far corner before your rivals do.',
    instructions: 'WASD or arrows to move. Reach the green exit cell.',
    world: { w: W, h: H }
  };

  function mazeGrid(seed) {
    return S.genMaze(seed, COLS, ROWS);
  }

  function bfs(grid, from) {
    var dist = new Int16Array(COLS * ROWS).fill(-1);
    var queue = [from.r * COLS + from.c];
    dist[from.r * COLS + from.c] = 0;
    for (var qi = 0; qi < queue.length; qi++) {
      var idx = queue[qi];
      var r = (idx / COLS) | 0, c = idx % COLS;
      var g = grid[r][c];
      var nb = [];
      if (!(g & 1) && r > 0) nb.push(idx - COLS);
      if (!(g & 2) && c < COLS - 1) nb.push(idx + 1);
      if (!(g & 4) && r < ROWS - 1) nb.push(idx + COLS);
      if (!(g & 8) && c > 0) nb.push(idx - 1);
      for (var i = 0; i < nb.length; i++) {
        if (dist[nb[i]] === -1) { dist[nb[i]] = dist[idx] + 1; queue.push(nb[i]); }
      }
    }
    return dist;
  }

  function init(players) {
    var st = { t: 0, ph: 1, seed: (Math.random() * 1e9) | 0, p: {} };
    st._grid = mazeGrid(st.seed);
    st._dist = bfs(st._grid, GOAL);
    players.forEach(function (r, i) {
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: CELL / 2 + 4, y: (ROWS - 1) * CELL + CELL / 2,
        vx: 0, vy: 0, fx: 0, fy: -1,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0,
        best: st._dist[(ROWS - 1) * COLS], fin: 0, mem: {}
      };
    });
    return st;
  }

  function cellOf(p) {
    return { c: S.clamp((p.x / CELL) | 0, 0, COLS - 1), r: S.clamp((p.y / CELL) | 0, 0, ROWS - 1) };
  }

  function onInput(st, pid, input) {
    var p = st.p[String(pid)];
    if (p && p.al) S.latch(p, input.k);
  }

  function onPlayerLeft(st, pid) {
    var p = st.p[String(pid)];
    if (p && p.al) { p.al = 0; p.deathT = st.t; }
  }

  function collideWalls(st, p) {
    var grid = st._grid;
    var pc = cellOf(p);
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var r = pc.r + dr, c = pc.c + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        var x0 = c * CELL, y0 = r * CELL;
        var nx = S.clamp(p.x, x0, x0 + CELL);
        var ny = S.clamp(p.y, y0, y0 + CELL);
        var dx = p.x - nx, dy = p.y - ny;
        var dd = Math.hypot(dx, dy);
        if (dd < PHYS.r) {
          var g = grid[r][c];
          var solid = false;
          if (g & 16) solid = true;
          if (dr === -1 && (g & 1) && p.y - y0 - CELL < PHYS.r && p.x >= x0 - PHYS.r && p.x <= x0 + CELL + PHYS.r) solid = true;
          if (dr === 1 && (g & 4) && y0 - p.y < PHYS.r && p.x >= x0 - PHYS.r && p.x <= x0 + CELL + PHYS.r) solid = true;
          if (dc === 1 && (g & 2) && x0 - p.x < PHYS.r && p.y >= y0 - PHYS.r && p.y <= y0 + CELL + PHYS.r) solid = true;
          if (dc === -1 && (g & 8) && p.x - x0 - CELL < PHYS.r && p.y >= y0 - PHYS.r && p.y <= y0 + CELL + PHYS.r) solid = true;
          if (solid && dd > 0.001) {
            p.x = nx + dx / dd * PHYS.r;
            p.y = ny + dy / dd * PHYS.r;
            p.vx *= 0.4;
            p.vy *= 0.4;
          } else if (solid) {
            p.x = pc.c * CELL + CELL / 2;
            p.y = pc.r * CELL + CELL / 2;
          }
        }
      }
    }
  }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al || p.fin) { S.endInput(p); continue; }
      S.drive(p, d, PHYS);
      collideWalls(st, p);
      var pc = cellOf(p);
      var didx = st._dist[pc.r * COLS + pc.c];
      if (didx >= 0 && didx < p.best) {
        p.best = didx;
        p.sc = (COLS * ROWS) - didx;
      }
      if (pc.c === GOAL.c && pc.r === GOAL.r && !p.fin) {
        p.fin = st.t;
        p.sc = COLS * ROWS + Math.max(0, Math.round(CONFIG.duration * 1000 - st.t) / 1000 | 0);
        S.fx('burst', { x: p.x, y: p.y, n: 36, speed: 320 });
      }
      S.endInput(p);
    }
    var keys = Object.keys(st.p);
    for (var a = 0; a < keys.length; a++) {
      for (var b = a + 1; b < keys.length; b++) {
        S.bounce(st.p[keys[a]], st.p[keys[b]], 10, 10, 0.6);
      }
    }
  }

  function checkWin(st) {
    var finished = [];
    for (var k in st.p) if (st.p[k].fin) finished.push(Number(k));
    if (finished.length) {
      finished.sort(function (a, b) { return st.p[a].fin - st.p[b].fin; });
      var rest = S.rank(st, 'sc').filter(function (k) { return !st.p[k].fin; });
      return { w: finished[0], reason: 'finish', rank: finished.concat(rest), sc: scores(st) };
    }
    if (st.t < CONFIG.duration * 1000) return null;
    var rank = S.rank(st, 'sc');
    return { w: rank[0], reason: 'time', rank: rank, sc: scores(st) };
  }

  function scores(st) {
    var o = {};
    for (var k in st.p) o[k] = st.p[k].sc;
    return o;
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc', 'best', 'fin'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 1, seed: st.seed, p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    var pd = {};
    for (var key in st.p) {
      var f = S.pd(st.p[key], last.p[key], PF);
      if (f) pd[key] = f;
    }
    if (Object.keys(pd).length) d.p = pd;
    return d;
  }

  function bots(st) {
    if (!st._path) {
      var par = new Int16Array(COLS * ROWS).fill(-1);
      var queue = [GOAL.r * COLS + GOAL.c];
      par[GOAL.r * COLS + GOAL.c] = GOAL.r * COLS + GOAL.c;
      for (var qi = 0; qi < queue.length; qi++) {
        var idx = queue[qi];
        var r = (idx / COLS) | 0, c = idx % COLS;
        var g = st._grid[r][c];
        var nb = [];
        if (!(g & 1) && r > 0) nb.push(idx - COLS);
        if (!(g & 2) && c < COLS - 1) nb.push(idx + 1);
        if (!(g & 4) && r < ROWS - 1) nb.push(idx + COLS);
        if (!(g & 8) && c > 0) nb.push(idx - 1);
        for (var i = 0; i < nb.length; i++) {
          if (par[nb[i]] === -1) { par[nb[i]] = idx; queue.push(nb[i]); }
        }
      }
      st._path = par;
    }
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.bot || !p.al || p.fin) continue;
      var pc = cellOf(p);
      var idx = pc.r * COLS + pc.c;
      var next = st._path[idx];
      if (next === -1 || next === idx) {
        p.aim = { x: Math.sin(st.t / 400 + p.slot) * 0.7, y: Math.cos(st.t / 500 + p.slot) * 0.7 };
        continue;
      }
      var nr = (next / COLS) | 0, nc = next % COLS;
      var tx = nc * CELL + CELL / 2, ty = nr * CELL + CELL / 2;
      var wob = Math.sin(st.t / 300 + p.slot * 2.1) * 0.25;
      p.aim = { x: (tx - p.x) / 40 + wob, y: (ty - p.y) / 40 };
    }
  }

  function render(ctx, view, meId) {
    var grid = S.genMaze(view.seed, COLS, ROWS);
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(0,255,242,0.5)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00fff2';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var g = grid[r][c];
        var x = c * CELL, y = r * CELL;
        if (g & 1) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
        if (g & 2) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
        if (g & 4) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
        if (g & 8) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    var pulse = 0.25 + 0.2 * Math.sin(view.now / 250);
    ctx.fillStyle = 'rgba(57,255,20,' + pulse.toFixed(2) + ')';
    ctx.fillRect(GOAL.c * CELL + 4, GOAL.r * CELL + 4, CELL - 8, CELL - 8);
    ctx.fillStyle = '#39ff14';
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚑', GOAL.c * CELL + CELL / 2, GOAL.r * CELL + CELL / 2);

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 11, color);
      S.text(ctx, p.name, p.x, p.y - 24, { size: 10, glow: color, blur: 6 });
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
