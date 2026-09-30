(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var COLS = 12, ROWS = 10, CELL_W = 60, CELL_H = 56, OFF_X = 40, OFF_Y = 20;
  var MOVE_MS = 150, CRACK_MS = 800, FALL_MS = 500, SUDDEN_MS = 45000, DURATION = 90000;
  var SPAWNS = [[1, 1], [10, 1], [1, 8], [10, 8]];

  var CONFIG = {
    id: 'tileCollapse', name: 'Tile Collapse', icon: '🧱',
    duration: 90, minPlayers: 2, maxPlayers: 4,
    description: 'Hop across a grid of neon tiles that crack and fall behind you. Outlive everyone else.',
    instructions: 'WASD / Arrows to hop. Tiles crack after you leave them, then fall. Last one standing wins.',
    world: { w: 800, h: 600 }
  };

  var HOP = {
    cols: COLS, rows: ROWS, cellW: CELL_W, cellH: CELL_H, offX: OFF_X, offY: OFF_Y, moveMs: MOVE_MS,
    canEnter: function (st, nx, ny) { return st.tiles[ny * COLS + nx] !== 2; },
    onLeave: function (st, p, i) {
      if (st.tiles[i] === 0 && !st.decay[i]) st.decay[i] = st.t + CRACK_MS;
    },
    onLand: function (st, p) {
      var i = p.gy * COLS + p.gx;
      if (st.tiles[i] === 2) die(st, p);
    }
  };

  function cx(gx) { return OFF_X + (gx + 0.5) * CELL_W; }
  function cy(gy) { return OFF_Y + (gy + 0.5) * CELL_H; }

  function init(players) {
    var st = {
      t: 0, ph: 0, seed: 0,
      tiles: new Array(COLS * ROWS).fill(0),
      decay: new Array(COLS * ROWS).fill(0),
      fallAt: new Array(COLS * ROWS).fill(0),
      p: {}
    };
    players.forEach(function (r) {
      var sp = SPAWNS[(r.s - 1) % 4];
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: cx(sp[0]), y: cy(sp[1]), gx: sp[0], gy: sp[1], d: -1, m: 0, ms: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0, mem: {}
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

  function die(st, p) {
    p.al = 0; p.deathT = st.t; p.m = 0; p.x = cx(p.gx); p.y = cy(p.gy);
    S.fx('death', { pid: pidOf(st, p), x: p.x, y: p.y });
  }

  function pidOf(st, p) {
    for (var k in st.p) if (st.p[k] === p) return Number(k);
    return 0;
  }

  function tick(st, dt) {
    st.t += dt;

    if (st.ph === 0 && st.t >= SUDDEN_MS) {
      st.ph = 1;
      for (var i = 0; i < st.tiles.length; i++) {
        if (st.tiles[i] === 0 && !st.decay[i]) st.decay[i] = st.t + 200 + Math.random() * 6000;
      }
    }

    for (var j = 0; j < st.tiles.length; j++) {
      var ph = st.tiles[j];
      if (ph === 0 && st.decay[j] && st.t >= st.decay[j]) {
        st.tiles[j] = 1;
        st.fallAt[j] = st.decay[j] + FALL_MS;
        S.fx('tile', { i: j, ph: 1 });
      } else if (ph === 1 && st.t >= st.fallAt[j]) {
        st.tiles[j] = 2;
        S.fx('tile', { i: j, ph: 2, x: OFF_X + (j % COLS + 0.5) * CELL_W, y: OFF_Y + ((j / COLS | 0) + 0.5) * CELL_H });
        for (var k in st.p) {
          var q = st.p[k];
          if (q.al && !q.m && q.gy * COLS + q.gx === j) die(st, q);
        }
      }
    }

    for (var key in st.p) {
      var p = st.p[key];
      if (!p.al) continue;
      S.hopStep(st, p, HOP);
      S.endInput(p);
    }
  }

  function checkWin(st) {
    var alive = [];
    for (var k in st.p) if (st.p[k].al) alive.push(Number(k));
    if (alive.length >= 2) {
      if (st.t < DURATION) return null;
      return { w: null, reason: 'timeout', rank: S.rank(st) };
    }
    if (alive.length === 1) return { w: alive[0], reason: 'last-standing', rank: S.rank(st) };
    return { w: null, reason: 'void', rank: S.rank(st) };
  }

  var PF = ['x', 'y', 'gx', 'gy', 'd', 'm', 'al'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: st.ph, seed: st.seed, tiles: st.tiles.slice(), p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr', 'sc']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    if (st.ph !== last.ph) d.ph = st.ph;
    var tl = [];
    for (var i = 0; i < st.tiles.length; i++) if (st.tiles[i] !== last.tiles[i]) tl.push(i, st.tiles[i]);
    if (tl.length) d.tl = tl;
    var pdl = {};
    for (var key in st.p) {
      var f = S.pd(st.p[key], last.p[key], PF);
      if (f) pdl[key] = f;
    }
    if (Object.keys(pdl).length) d.p = pdl;
    return d;
  }

  function bots(st) {
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.bot || !p.al) continue;
      if (p.m) { p.aim = null; continue; }
      var danger = st.tiles[p.gy * COLS + p.gx] !== 0 || st.ph === 1;
      var best = -1, bestScore = -1e9;
      for (var d = 0; d < 4; d++) {
        var nx = p.gx + S.DIRX[d], ny = p.gy + S.DIRY[d];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        var i = ny * COLS + nx;
        if (st.tiles[i] === 2) continue;
        var score = 50 - (st.decay[i] ? Math.max(0, 3000 - (st.decay[i] - st.t)) / 60 : 0);
        if (st.tiles[i] === 1) score -= 20;
        score += Math.random() * 12;
        if (score > bestScore) { bestScore = score; best = d; }
      }
      if (best >= 0 && (danger || Math.random() < 0.75)) {
        p.aim = { x: S.DIRX[best], y: S.DIRY[best] };
      } else p.aim = null;
    }
  }

  function tileRect(i) {
    return {
      x: OFF_X + (i % COLS) * CELL_W + 4,
      y: OFF_Y + ((i / COLS) | 0) * CELL_H + 4,
      w: CELL_W - 8, h: CELL_H - 8
    };
  }

  function tRand(i, salt) {
    var v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function render(ctx, view, meId) {
    var now = view.now;
    for (var i = 0; i < view.tiles.length; i++) {
      var ph = view.tiles[i];
      if (ph === 2) {
        var f0 = view.anim.tiles[i] && view.anim.tiles[i].ph === 2 ? view.anim.tiles[i].t : 0;
        if (f0 && now - f0 < 320) drawFall(ctx, i, (now - f0) / 320);
        continue;
      }
      drawTile(ctx, i, ph, now, view.anim);
    }
    var pids = Object.keys(view.players);
    pids.forEach(function (pid) { if (!view.players[pid].al) drawDead(ctx, view, pid, now); });
    pids.forEach(function (pid) { if (view.players[pid].al) drawLive(ctx, view, pid, String(pid) === String(meId)); });
  }

  function drawTile(ctx, i, ph, now, anim) {
    var r = tileRect(i);
    var cracked = ph === 1;
    var ev = anim.tiles[i];
    var pop = cracked && ev && ev.ph === 1 ? Math.max(0, 1 - (now - ev.t) / 180) : 0;
    ctx.save();
    if (cracked) ctx.translate(Math.sin(now / 45 + i * 1.7) * 1.1, Math.cos(now / 38 + i) * 1.1);
    ctx.fillStyle = cracked ? 'rgba(255,102,0,0.05)' : 'rgba(0,255,242,0.05)';
    S.rrect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pop > 0 ? 'rgba(255,255,255,' + (0.4 + 0.6 * pop) + ')'
      : cracked ? 'rgba(255,140,60,0.4)' : 'rgba(0,255,242,0.35)';
    ctx.stroke();
    if (cracked) {
      ctx.strokeStyle = 'rgba(10,10,15,0.9)';
      ctx.lineWidth = 2;
      for (var c = 0; c < 3; c++) {
        var sx = r.x + r.w * (0.2 + 0.6 * tRand(i, c));
        var sy = r.y + r.h * (0.15 + 0.7 * tRand(i, c + 7));
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (tRand(i, c + 3) - 0.5) * 22, sy + (tRand(i, c + 5) - 0.5) * 20);
        ctx.lineTo(sx + (tRand(i, c + 4) - 0.5) * 30, sy + (tRand(i, c + 6) - 0.5) * 26);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFall(ctx, i, prog) {
    var r = tileRect(i);
    ctx.save();
    ctx.globalAlpha = 1 - prog;
    ctx.translate(0, prog * prog * 70);
    var s = 1 - prog * 0.45;
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(s, s);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
    ctx.fillStyle = 'rgba(0,255,242,0.04)';
    S.rrect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,255,242,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawLive(ctx, view, pid, isMe) {
    var p = view.players[pid];
    var color = S.COLORS[(p.slot - 1) % 4];
    if (isMe) S.meRing(ctx, p.x, p.y, color, view.now);
    S.shape(ctx, p.x, p.y, p.sh, 14, color);
    ctx.globalAlpha = 0.9;
    S.text(ctx, p.name, p.x, p.y - 27, { size: 10, glow: color, blur: 6 });
    ctx.globalAlpha = 1;
  }

  function drawDead(ctx, view, pid, now) {
    var t0 = view.anim.deaths[pid];
    if (t0 === undefined) return;
    var prog = (now - t0) / 700;
    if (prog >= 1) return;
    var p = view.players[pid];
    var color = S.COLORS[(p.slot - 1) % 4];
    ctx.save();
    ctx.globalAlpha = 1 - prog;
    ctx.translate(p.x, p.y + prog * prog * 90);
    ctx.rotate(prog * 5);
    var s = 1 - prog * 0.8;
    ctx.scale(s, s);
    S.shape(ctx, 0, 0, p.sh, 14, color);
    ctx.restore();
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
