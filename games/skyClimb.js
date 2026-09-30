(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['skyClimb'])
    || require('./skyClimb.ai.js');
  var W = 800, H = 4200, ROWS = 42, GAP = 95;
  var PHYS = { grav: 1400, jump: 620, speed: 300, friction: 6, r: 12, w: W };
  var TOP_Y = 120;

  var CONFIG = {
    id: 'skyClimb', name: 'Sky Climb', icon: '🧗',
    duration: 120, minPlayers: 2, maxPlayers: 4,
    description: 'A vertical neon tower of floating platforms. First to the top wins.',
    instructions: 'A / D to move, Space to jump. Climb to the top before everyone else.',
    world: { w: W, h: H, cam: true }
  };

  function plats(st) {
    if (!st._plats) {
      st._plats = S.genLadder(st.seed, ROWS, GAP, W, 90, 170);
      st._plats.push({ x: 12, y: 4110, w: W - 24 });
    }
    return st._plats;
  }

  function init(players) {
    var st = { t: 0, ph: 0, seed: (Math.random() * 1e9) | 0, p: {} };
    players.forEach(function (r, i) {
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: 120 + i * 180, y: 4076, vx: 0, vy: 0, fx: 0, fy: -1,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0,
        best: H, fin: 0, ground: 0, mem: {}
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
    var list = plats(st);
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.platStep(st, p, d, { grav: PHYS.grav, jump: PHYS.jump, speed: PHYS.speed, friction: PHYS.friction, r: PHYS.r, w: W, plats: list });
      if (p.y > H + 80) {
        p.al = 0; p.deathT = st.t;
        S.fx('death', { x: p.x, y: H - 20 });
        continue;
      }
      if (p.y < p.best) p.best = p.y;
      p.sc = Math.max(0, Math.round((H - p.best) / 10));
      if (p.y < TOP_Y && !p.fin) {
        p.fin = st.t;
        S.fx('burst', { x: p.x, y: p.y, n: 40, speed: 320 });
      }
      S.endInput(p);
    }
    for (var key in st.p) {
      for (var q in st.p) {
        if (key === q) continue;
        var a = st.p[key], b = st.p[q];
        if (a.al && b.al && Math.abs(a.x - b.x) < 24 && Math.abs(a.y - b.y) < 24 && a.y < b.y) {
          var dy = b.y - a.y;
          if (dy < 18 && a.vy > 0) {
            a.y = b.y - 22;
            a.vy = b.vy - 80;
            b.vy = -160;
            S.fx('burst', { x: a.x, y: a.y, n: 6, speed: 90 });
          }
        }
      }
    }
  }

  function checkWin(st) {
    var finished = [];
    for (var k in st.p) if (st.p[k].fin) finished.push(Number(k));
    if (finished.length) {
      finished.sort(function (a, b) { return st.p[a].fin - st.p[b].fin; });
      var rest = S.rank(st, 'best').filter(function (k) { return finished.indexOf(Number(k)) < 0; });
      return { w: finished[0], reason: 'finish', rank: finished.concat(rest), sc: scores(st) };
    }
    if (st.t < CONFIG.duration * 1000) return null;
    var rank = S.rank(st, 'best');
    return { w: rank[0], reason: 'time', rank: rank, sc: scores(st) };
  }

  function scores(st) {
    var o = {};
    for (var k in st.p) o[k] = st.p[k].sc;
    return o;
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc', 'best', 'fin', 'ground'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: st.seed, p: {} };
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
      if (p.skill === undefined) {
        var srr = Math.random();
        p.skill = srr < 0.5 ? 3 : srr < 0.8 ? 4 : srr < 0.93 ? 5 : srr < 0.985 ? 6 : 7;
      }
      var sk = Math.max(1, Math.min(10, p.skill || 4));
      var d = AI.think(st, p, sk, { plats: function () { return plats(st); } });
      if (!d) { p.aim = null; continue; }
      p.aim = d.aim !== undefined ? d.aim : null;
      if (d.k) S.latch(p, d.k);
      if (d.tap) p.tp |= 16;
      if (d.tp !== undefined) p.tp = d.tp;
    }
  }

  function render(ctx, view, meId) {
    var list = plats({ seed: view.seed });
    var camY = 0;
    for (var pid in view.players) {
      if (String(pid) === String(meId) && view.players[pid].al) camY = view.players[pid].y - 300;
    }
    camY = S.clamp(camY, 0, H - 600);

    ctx.save();
    ctx.translate(0, -camY);

    var from = Math.max(0, ((camY - 100) / GAP) | 0);
    var to = Math.min(list.length, ((camY + 700) / GAP) | 0);
    for (var i = from; i < to; i++) {
      var pl = list[i];
      ctx.fillStyle = 'rgba(0,255,242,0.07)';
      S.rrect(ctx, pl.x, pl.y, pl.w, 10, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,255,242,0.55)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#00fff2';
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    S.text(ctx, '★ FINISH ★', W / 2, 70, { size: 26, glow: '#39ff14', color: '#39ff14' });

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 12, color);
      S.text(ctx, p.name, p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });
    ctx.restore();

    var minBest = 1e9;
    pids.forEach(function (pid) { if (view.players[pid].best < minBest) minBest = view.players[pid].best; });
    if (minBest < 1e9) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#39ff14';
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(0, minBest - camY);
      ctx.lineTo(W, minBest - camY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
