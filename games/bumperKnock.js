(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['bumperKnock'])
    || require('./bumperKnock.ai.js');
  var CX = 400, CY = 300;
  var RADII = [270, 215, 160, 110];
  var PHYS = { speed: 300, friction: 3.5 };
  var DASH = { power: 520, cd: 2000 };

  var CONFIG = {
    id: 'bumperKnock', name: 'Bumper Knock', icon: '🥊',
    duration: 75, minPlayers: 2, maxPlayers: 4,
    description: 'Sumo in a shrinking neon ring. Dash into rivals to launch them off the edge.',
    instructions: 'WASD / Arrows to move, Space to dash (2s cooldown). Knock everyone off. Last one in wins.',
    world: { w: 800, h: 600 }
  };

  function radius(st) { return RADII[Math.min((st.t / 15000) | 0, RADII.length - 1)]; }

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {} };
    players.forEach(function (r, i) {
      var a = i / players.length * Math.PI * 2 + 0.6;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: CX + Math.cos(a) * 170, y: CY + Math.sin(a) * 170,
        vx: 0, vy: 0, fx: Math.cos(a), fy: Math.sin(a),
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

  function die(st, p) {
    p.al = 0; p.deathT = st.t;
    S.fx('death', { x: p.x, y: p.y, pid: pidKey(st, p) });
    S.fx('shake', { mag: 5 });
  }

  function pidKey(st, p) { for (var k in st.p) if (st.p[k] === p) return Number(k); return 0; }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    var R = radius(st);
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.drive(p, d, PHYS);
      S.dash(p, DASH);
      S.tickCd(p, d);
      if (S.offCircle(p, CX, CY, R + 12)) die(st, p);
      else S.endInput(p);
    }
    var ids = Object.keys(st.p);
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = st.p[ids[i]], b = st.p[ids[j]];
        if (!a.al || !b.al) continue;
        if (S.bounce(a, b, 14, 14, { e: 0.75 })) {
          if (a.dashT > 0) launch(a, b);
          if (b.dashT > 0) launch(b, a);
        }
      }
    }
  }

  function launch(from, to) {
    var dx = to.x - from.x, dy = to.y - from.y;
    var d = Math.hypot(dx, dy) || 1;
    var power = 300 + Math.hypot(from.vx, from.vy) * 0.6;
    to.vx += dx / d * power;
    to.vy += dy / d * power;
    from.vx -= dx / d * 90;
    from.vy -= dy / d * 90;
    S.fx('burst', { x: to.x, y: to.y, n: 12, speed: 220 });
  }

  function checkWin(st) {
    var alive = [];
    for (var k in st.p) if (st.p[k].al) alive.push(Number(k));
    if (alive.length >= 2 && st.t < CONFIG.duration * 1000) return null;
    if (alive.length === 1) return { w: alive[0], reason: 'last-standing', rank: S.rank(st) };
    return { w: null, reason: st.t >= CONFIG.duration * 1000 ? 'time' : 'void', rank: S.rank(st) };
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'dcd', 'dashT'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: st.ph, seed: 0, p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr', 'sc']));
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
      var d = AI.think(st, p, sk, { radius: function () { return radius(st); } });
      if (!d) { p.aim = null; continue; }
      p.aim = d.aim !== undefined ? d.aim : null;
      if (d.k) S.latch(p, d.k);
      if (d.tap) p.tp |= 16;
      if (d.tp !== undefined) p.tp = d.tp;
    }
  }

  function render(ctx, view, meId) {
    var R = RADII[Math.min((view.t / 15000) | 0, RADII.length - 1)];
    var next = (view.t / 15000) | 0;
    var shrinkIn = 15000 - (view.t - next * 15000);

    ctx.strokeStyle = 'rgba(0,255,242,0.5)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00fff2';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, 6.2832);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,255,242,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(CX, CY, R + 14, 0, 6.2832);
    ctx.stroke();

    if (shrinkIn < 3000 && R > RADII[RADII.length - 1]) {
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(view.now / 120);
      S.text(ctx, 'SHRINKING', CX, CY - R - 26, { size: 13, glow: '#ff6600', color: '#ff6600' });
      ctx.globalAlpha = 1;
    }

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) { if (!view.players[pid].al) drawDead(ctx, view, pid, view.now); });
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      if (p.dashT > 0) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 20, 0, 6.2832);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      S.shape(ctx, p.x, p.y, p.sh, 14, color);
      S.text(ctx, p.name, p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });
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
