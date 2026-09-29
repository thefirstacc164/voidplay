(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var CX = 400, CY = 300, R = 280;
  var BEAMS = 3, BEAM_W = 15;
  var ORBITS = [
    { r: 125, size: 17, speed: 0.0011, ph: 0.4 },
    { r: 195, size: 21, speed: -0.0009, ph: 2.6 },
    { r: 258, size: 15, speed: 0.0007, ph: 4.4 }
  ];

  var CONFIG = {
    id: 'orbitDodge', name: 'Orbit Dodge', icon: '🪐',
    duration: 60, minPlayers: 2, maxPlayers: 4,
    description: 'Radial laser beams and circling planets, all spinning faster and faster.',
    instructions: 'Dodge the rotating beams and orbiting planets with WASD / Arrows. Survive to score. Last one breathing wins.',
    world: { w: 800, h: 600 }
  };

  var PHYS = { speed: 285, friction: 4.2 };

  function beamAngle(t, i) {
    return i * (Math.PI * 2 / BEAMS) + t * (0.00050 + t * 0.00000008);
  }

  function planetPos(t, o) {
    var a = o.ph + t * o.speed;
    return { x: CX + Math.cos(a) * o.r, y: CY + Math.sin(a) * o.r };
  }

  function beamHit(t, p) {
    var dx = p.x - CX, dy = p.y - CY;
    var r = Math.hypot(dx, dy);
    if (r < 26 || r > R) return false;
    var theta = Math.atan2(dy, dx);
    for (var i = 0; i < BEAMS; i++) {
      var a = beamAngle(t, i);
      if (Math.abs(Math.sin(theta - a)) * r < BEAM_W + 10) return true;
    }
    return false;
  }

  function init(players) {
    var st = { t: 0, ph: 0, seed: (Math.random() * 1e9) | 0, p: {}, scd: 0 };
    var base = S.rng(st.seed)() * Math.PI * 2;
    players.forEach(function (r, i) {
      var a = base + i / players.length * Math.PI * 2;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: CX + Math.cos(a) * 160, y: CY + Math.sin(a) * 160,
        vx: 0, vy: 0, fx: 1, fy: 0,
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
    p.al = 0; p.deathT = st.t;
    S.fx('death', { x: p.x, y: p.y });
    S.fx('burst', { x: p.x, y: p.y, n: 26, speed: 280, color: '#ff00e4' });
    S.fx('shake', { mag: 4 });
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
      S.drive(p, d, PHYS);
      S.wallsCircle(p, CX, CY, R, 12, 0.4);
      if (st.t > 1200 && beamHit(st.t, p)) { die(st, p); continue; }
      var hit = false;
      for (var i = 0; i < ORBITS.length; i++) {
        var o = planetPos(st.t, ORBITS[i]);
        if (S.dist(p.x, p.y, o.x, o.y) < ORBITS[i].size + 11) { hit = true; break; }
      }
      if (hit && st.t > 1200) { die(st, p); continue; }
      if (award) p.sc++;
      S.endInput(p);
    }
  }

  function checkWin(st) {
    var alive = [];
    for (var k in st.p) if (st.p[k].al) alive.push(Number(k));
    if (alive.length >= 2 && st.t < CONFIG.duration * 1000) return null;
    var rank = S.rank(st, 'sc');
    if (alive.length === 1) return { w: alive[0], reason: 'last-standing', rank: rank };
    return { w: rank[0], reason: st.t >= CONFIG.duration * 1000 ? 'time' : 'void', rank: rank };
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc'];

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
      var ax = 0, ay = 0;
      var dx = p.x - CX, dy = p.y - CY;
      var r = Math.hypot(dx, dy) || 1;
      if (r > 235) { ax -= dx / r; ay -= dy / r; }
      if (r < 90) { ax += dx / r; ay += dy / r; }

      var theta = Math.atan2(dy, dx);
      for (var i = 0; i < BEAMS; i++) {
        var a = beamAngle(st.t, i);
        if (Math.abs(Math.sin(theta - a)) * r < 130) {
          var tang = theta + Math.PI / 2;
          ax += Math.cos(tang) * 1.2;
          ay += Math.sin(tang) * 1.2;
        }
      }
      for (var j = 0; j < ORBITS.length; j++) {
        var o = planetPos(st.t, ORBITS[j]);
        var pdx = p.x - o.x, pdy = p.y - o.y;
        var pd = Math.hypot(pdx, pdy) || 1;
        if (pd < 90) { ax += pdx / pd * (1 - pd / 90); ay += pdy / pd * (1 - pd / 90); }
      }
      ax += Math.sin(st.t / 700 + p.slot * 2.9) * 0.45;
      ay += Math.cos(st.t / 870 + p.slot * 1.3) * 0.45;
      var l = Math.hypot(ax, ay);
      if (l > 0.05) p.aim = { x: ax / l, y: ay / l };
      else p.aim = { x: -dy / r, y: dx / r };
    }
  }

  function render(ctx, view, meId) {
    ctx.fillStyle = 'rgba(255,0,228,0.16)';
    ctx.beginPath();
    ctx.arc(CX, CY, 22, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,255,242,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, 6.2832);
    ctx.stroke();

    for (var i = 0; i < BEAMS; i++) {
      var a = beamAngle(view.t, i);
      var grd = ctx.createLinearGradient(CX, CY, CX + Math.cos(a) * R, CY + Math.sin(a) * R);
      grd.addColorStop(0, 'rgba(255,0,228,0.9)');
      grd.addColorStop(1, 'rgba(255,0,228,0.15)');
      ctx.strokeStyle = grd;
      ctx.lineWidth = BEAM_W;
      ctx.shadowColor = '#ff00e4';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(a) * 26, CY + Math.sin(a) * 26);
      ctx.lineTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    for (var j = 0; j < ORBITS.length; j++) {
      var o = ORBITS[j];
      var pos = planetPos(view.t, o);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(CX, CY, o.r, 0, 6.2832);
      ctx.stroke();
      ctx.fillStyle = '#8a7dff';
      ctx.shadowColor = '#8a7dff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, o.size, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) { if (!view.players[pid].al) drawDead(ctx, view, pid, view.now); });
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      if (view.t < 1200) ctx.globalAlpha = 0.5 + 0.4 * Math.sin(view.now / 80);
      S.shape(ctx, p.x, p.y, p.sh, 12, color);
      ctx.globalAlpha = 1;
      S.text(ctx, p.name + ' ' + (p.sc || 0), p.x, p.y - 24, { size: 10, glow: color, blur: 6 });
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
    S.shape(ctx, p.x, p.y, p.sh, 12 * (1 - prog * 0.7), color);
    ctx.restore();
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
