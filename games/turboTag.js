(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var CX = 400, CY = 300, R = 270;
  var IT = { speed: 345, friction: 4 };
  var RUN = { speed: 265, friction: 4 };
  var TAG = 30;

  var CONFIG = {
    id: 'turboTag', name: 'Turbo Tag', icon: '🏃',
    duration: 60, minPlayers: 2, maxPlayers: 4,
    description: 'Whoever is IT is faster. Being IT drains your score, so keep running.',
    instructions: 'Avoid being IT. You lose points every moment you hold it; the least tagged player wins.',
    world: { w: 800, h: 600 }
  };

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {}, it: 0, imm: 1200 };
    players.forEach(function (r, i) {
      var a = i / players.length * Math.PI * 2 + 0.6;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: CX + Math.cos(a) * 200, y: CY + Math.sin(a) * 200,
        vx: 0, vy: 0, fx: 1, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, pen: 0, sc: 0, mem: {}
      };
    });
    var keys = Object.keys(st.p);
    st.it = Number(keys[(Math.random() * keys.length) | 0]);
    return st;
  }

  function onInput(st, pid, input) {
    var p = st.p[String(pid)];
    if (p && p.al) S.latch(p, input.k);
  }

  function onPlayerLeft(st, pid) {
    var p = st.p[String(pid)];
    if (p && p.al) { p.al = 0; p.deathT = st.t; }
    if (st.it === Number(pid)) nextIt(st);
  }

  function nextIt(st, exclude) {
    var pool = [];
    for (var k in st.p) {
      if (!st.p[k].al || Number(k) === exclude) continue;
      pool.push(Number(k));
    }
    if (!pool.length) { st.it = 0; return; }
    st.it = pool[(Math.random() * pool.length) | 0];
    st.imm = 1200;
  }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    if (st.imm > 0) st.imm -= dt;
    st.pcd = (st.pcd || 0) + d;
    var drain = st.pcd >= 0.5;
    if (drain) st.pcd -= 0.5;

    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      var isIt = Number(k) === st.it;
      S.drive(p, d, isIt ? IT : RUN);
      S.wallsCircle(p, CX, CY, R, 14, 0.5);
      if (isIt && drain) { p.pen += 0.5; p.sc = Math.round(p.pen); }
      S.endInput(p);
    }

    var it = st.p[String(st.it)];
    if (it && it.al && st.imm <= 0) {
      for (var q in st.p) {
        var o = st.p[q];
        if (!o.al || o === it) continue;
        if (S.dist(it.x, it.y, o.x, o.y) < TAG) {
          nextIt(st, st.it);
          st.it = Number(q);
          st.imm = 1200;
          S.fx('burst', { x: o.x, y: o.y, n: 14, speed: 200 });
          S.fx('shake', { mag: 3 });
          break;
        }
      }
    }
  }

  function checkWin(st) {
    if (st.t < CONFIG.duration * 1000) return null;
    var ids = Object.keys(st.p).map(Number);
    ids.sort(function (a, b) {
      var pa = st.p[a], pb = st.p[b];
      if (pa.al !== pb.al) return pa.al ? -1 : 1;
      return pa.pen - pb.pen;
    });
    var sc = {};
    for (var k in st.p) sc[k] = Math.round(st.p[k].pen);
    return { w: ids[0], reason: 'time', rank: ids, sc: sc, lowWins: 1 };
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: 0, it: st.it, p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    if (st.it !== last.it) d.it = st.it;
    var pd = {};
    for (var key in st.p) {
      var f = S.pd(st.p[key], last.p[key], PF);
      if (f) pd[key] = f;
    }
    if (Object.keys(pd).length) d.p = pd;
    return d;
  }

  function bots(st) {
    var it = st.p[String(st.it)];
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.bot || !p.al) continue;
      var target = null, best = 1e9;
      for (var q in st.p) {
        var o = st.p[q];
        if (!o.al || o === p) continue;
        var dd = S.dist(p.x, p.y, o.x, o.y);
        if (dd < best) { best = dd; target = o; }
      }
      if (Number(k) === st.it) {
        if (target) {
          var dx = target.x - p.x, dy = target.y - p.y;
          var l = Math.hypot(dx, dy) || 1;
          p.aim = { x: dx / l, y: dy / l };
        }
      } else if (it && it.al) {
        var dx2 = p.x - it.x, dy2 = p.y - it.y;
        var l2 = Math.hypot(dx2, dy2) || 1;
        p.aim = { x: dx2 / l2, y: dy2 / l2 };
        var mx = p.x + p.aim.x * 70, my = p.y + p.aim.y * 70;
        if (S.dist(mx, my, CX, CY) > R - 40) p.aim = { x: (CX - p.x) / 200, y: (CY - p.y) / 200 };
      } else if (target) {
        var dx3 = target.x - p.x, dy3 = target.y - p.y;
        var l3 = Math.hypot(dx3, dy3) || 1;
        p.aim = { x: -dx3 / l3, y: -dy3 / l3 };
      }
    }
  }

  function render(ctx, view, meId) {
    ctx.strokeStyle = 'rgba(0,255,242,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, 6.2832);
    ctx.stroke();

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      var isIt = Number(pid) === view.it;
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 14, color);
      if (isIt) {
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(view.now / 110);
        S.text(ctx, 'IT', p.x, p.y - 42, { size: 13, glow: '#ff00e4', color: '#ff00e4' });
        ctx.globalAlpha = 1;
      }
      S.text(ctx, p.name, p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
