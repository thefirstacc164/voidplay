(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var CX = 400, CY = 300, R = 270, HR = 90;
  var PHYS = { speed: 290, friction: 3.8 };
  var DASH = { power: 480, cd: 2200 };

  var CONFIG = {
    id: 'kingOfTheHill', name: 'King of the Hill', icon: '👑',
    duration: 75, minPlayers: 2, maxPlayers: 4,
    description: 'Hold the glowing hill alone to score. Shove everyone else off it.',
    instructions: 'Be the only player inside the center ring to earn points. Space to dash. Highest score wins.',
    world: { w: 800, h: 600 }
  };

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {} };
    players.forEach(function (r, i) {
      var a = i / players.length * Math.PI * 2 + 0.6;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: CX + Math.cos(a) * 200, y: CY + Math.sin(a) * 200,
        vx: 0, vy: 0, fx: 1, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0, dcd: 0, dashT: 0, mem: {}
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

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;

    var inHill = [];
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.drive(p, d, PHYS);
      S.dash(p, DASH);
      S.tickCd(p, d);
      S.wallsCircle(p, CX, CY, R, 14, 0.5);
      if (S.dist(p.x, p.y, CX, CY) < HR) inHill.push(p);
      S.endInput(p);
    }

    if (inHill.length === 1) {
      inHill[0].sc += d;
      inHill[0].sc = Math.round(inHill[0].sc * 10) / 10;
    }

    var ids = Object.keys(st.p);
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = st.p[ids[i]], b = st.p[ids[j]];
        if (a.al && b.al) S.bounce(a, b, 14, 14, { e: 0.85 });
      }
    }
  }

  function checkWin(st) {
    if (st.t < CONFIG.duration * 1000) return null;
    var rank = S.rank(st, 'sc');
    var sc = {};
    for (var k in st.p) sc[k] = st.p[k].sc;
    return { w: rank[0], reason: 'time', rank: rank, sc: sc };
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc', 'dcd', 'dashT'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: 0, p: {} };
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
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.bot || !p.al) continue;
      var dc = S.dist(p.x, p.y, CX, CY);
      var jitter = Math.sin(st.t / 400 + p.slot * 2) * 0.5;
      var tx = CX - p.x, ty = CY - p.y;
      var l = Math.hypot(tx, ty) || 1;
      if (dc > HR * 0.55) {
        p.aim = { x: tx / l + jitter * 0.3, y: ty / l - jitter * 0.3 };
      } else {
        var enemy = null, best = 1e9;
        for (var q in st.p) {
          var o = st.p[q];
          if (!o.al || o === p) continue;
          if (S.dist(o.x, o.y, CX, CY) < HR + 20) {
            var dd = S.dist(p.x, p.y, o.x, o.y);
            if (dd < best) { best = dd; enemy = o; }
          }
        }
        if (enemy && best < 70) {
          var dx = enemy.x - p.x, dy = enemy.y - p.y;
          var el = Math.hypot(dx, dy) || 1;
          p.aim = { x: dx / el, y: dy / el };
          if (best < 55 && p.dcd <= 0 && Math.random() < 0.15) p.tp |= 16;
        } else p.aim = { x: Math.cos(st.t / 700 + p.slot * 2) * 0.4, y: Math.sin(st.t / 700 + p.slot * 2) * 0.4 };
      }
    }
  }

  function render(ctx, view, meId) {
    ctx.strokeStyle = 'rgba(0,255,242,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, 6.2832);
    ctx.stroke();

    var alone = true, holder = null, count = 0;
    for (var pid0 in view.players) {
      var pp = view.players[pid0];
      if (pp.al && S.dist(pp.x, pp.y, CX, CY) < HR) { count++; holder = pp; }
    }
    alone = count === 1;

    var hillColor = alone ? S.COLORS[(holder.slot - 1) % 4] : '#ffffff';
    ctx.globalAlpha = 0.1 + (alone ? 0.1 : 0.03) + 0.04 * Math.sin(view.now / 300);
    ctx.fillStyle = hillColor;
    ctx.beginPath();
    ctx.arc(CX, CY, HR, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = alone ? 0.9 : 0.4;
    ctx.strokeStyle = hillColor;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = hillColor;
    ctx.shadowBlur = alone ? 14 : 5;
    ctx.beginPath();
    ctx.arc(CX, CY, HR, 0, 6.2832);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 14, color);
      S.text(ctx, p.name + ' ' + (p.sc || 0), p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
