(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['infected'])
    || require('./infected.ai.js');
  var W = 800, H = 600;
  var SURV = { speed: 255, friction: 4 };
  var INF = { speed: 295, friction: 4 };
  var TAG = 30;

  var CONFIG = {
    id: 'infected', name: 'Infected', icon: '☣️',
    duration: 60, minPlayers: 2, maxPlayers: 4,
    description: 'One player starts infected. Touch spreads it. Survive to score, tag to score big.',
    instructions: 'Run from the infected (green). Survivors score 1/sec, each tag is worth 25. Highest score wins.',
    world: { w: W, h: H }
  };

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {}, scd: 0, inf: 0 };
    players.forEach(function (r, i) {
      var a = i / players.length * Math.PI * 2 + 0.6;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: W / 2 + Math.cos(a) * 240, y: H / 2 + Math.sin(a) * 180,
        vx: 0, vy: 0, fx: 1, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0, inf: 0, mem: {}
      };
    });
    var keys = Object.keys(st.p);
    st.inf = Number(keys[(Math.random() * keys.length) | 0]);
    st.p[String(st.inf)].inf = 1;
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
    st.scd += d;
    var award = st.scd >= 1;
    if (award) st.scd -= 1;

    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.drive(p, d, p.inf ? INF : SURV);
      S.wallsRect(p, W, H, 14, 0.5);
      if (award && !p.inf) p.sc++;
      S.endInput(p);
    }

    var ids = Object.keys(st.p);
    for (var i = 0; i < ids.length; i++) {
      var a = st.p[ids[i]];
      if (!a.al || !a.inf) continue;
      for (var j = 0; j < ids.length; j++) {
        var b = st.p[ids[j]];
        if (!b.al || b.inf) continue;
        if (S.dist(a.x, a.y, b.x, b.y) < TAG) {
          b.inf = 1;
          a.sc += 25;
          S.fx('burst', { x: b.x, y: b.y, n: 20, speed: 200, color: '#39ff14' });
          S.fx('shake', { mag: 3 });
        }
      }
    }
  }

  function checkWin(st) {
    if (st.t < CONFIG.duration * 1000) return null;
    var all = true;
    for (var k in st.p) if (st.p[k].al && !st.p[k].inf) all = false;
    var rank = S.rank(st, 'sc');
    return { w: rank[0], reason: 'time', rank: rank, sc: scores(st) };
  }

  function scores(st) {
    var o = {};
    for (var k in st.p) o[k] = st.p[k].sc;
    return o;
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc', 'inf'];

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
    ctx.strokeStyle = 'rgba(0,255,242,0.25)';
    ctx.lineWidth = 2;
    S.rrect(ctx, 12, 12, W - 24, H - 24, 14);
    ctx.stroke();

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = p.inf ? '#39ff14' : S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      if (p.inf) {
        ctx.globalAlpha = 0.25 + 0.12 * Math.sin(view.now / 160 + p.slot);
        ctx.fillStyle = '#39ff14';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 26, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      S.shape(ctx, p.x, p.y, p.sh, 14, color);
      S.text(ctx, p.name + ' ' + (p.sc || 0), p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
