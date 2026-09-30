(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['laserMaze'])
    || require('./laserMaze.ai.js');
  var W = 800, H = 600;
  var LASERS = [
    { vert: false, amp: 250, sp: 0.00034, ph: 0.0 },
    { vert: false, amp: 250, sp: 0.00047, ph: 2.1 },
    { vert: true, amp: 350, sp: 0.00039, ph: 1.0 },
    { vert: true, amp: 350, sp: 0.00029, ph: 4.2 }
  ];
  var THICK = 13;

  var CONFIG = {
    id: 'laserMaze', name: 'Laser Maze', icon: '🔺',
    duration: 60, minPlayers: 2, maxPlayers: 4,
    description: 'Sweeping laser walls crisscross the arena, accelerating the whole time.',
    instructions: 'Slip between the sweeping lasers with WASD / Arrows. One touch and you are vaporized.',
    world: { w: W, h: H }
  };

  var PHYS = { speed: 290, friction: 4.5 };

  function laserPos(t, L) {
    var base = L.vert ? W / 2 : H / 2;
    var speedUp = 1 + t / 40000;
    return base + Math.sin(t * L.sp * speedUp + L.ph) * L.amp;
  }

  function laserHit(t, p) {
    for (var i = 0; i < LASERS.length; i++) {
      var L = LASERS[i];
      var pos = laserPos(t, L);
      if (L.vert) {
        if (Math.abs(p.x - pos) < THICK + 10) return true;
      } else {
        if (Math.abs(p.y - pos) < THICK + 10) return true;
      }
    }
    return false;
  }

  function safeSpot(i, r) {
    var rng = S.rng(9871 + i * 7717);
    if (r.bot) {
      var top = r.s % 2 === 1;
      var left = r.s < 3;
      var h = [laserPos(220, LASERS[0]), laserPos(220, LASERS[1])].sort(function (a, b) { return a - b; });
      var v = [laserPos(220, LASERS[2]), laserPos(220, LASERS[3])].sort(function (a, b) { return a - b; });
      var x = left ? v[0] - 30 : v[1] + 30;
      var y = top ? h[0] - 30 : h[1] + 30;
      x = S.clamp(x, 40, W - 40);
      y = S.clamp(y, 40, H - 40);
      return { x: x, y: y };
    }
    for (var tries = 0; tries < 200; tries++) {
      var x2 = 60 + rng() * (W - 120);
      var y2 = 60 + rng() * (H - 120);
      if (!laserHit(0, { x: x2, y: y2 }) && !laserHit(400, { x: x2, y: y2 })) return { x: x2, y: y2 };
    }
    return { x: W / 2, y: H / 2 };
  }

  function init(players) {
    var sd = 0;
    players.forEach(function (r) { sd = (sd * 31 + r.i * 7 + String(r.n).length * 13) % 99991; });
    var st = { t: 0, ph: 0, seed: sd, p: {}, scd: 0 };
    players.forEach(function (r, i) {
      var sp = safeSpot(i, r);
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: sp.x, y: sp.y,
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
    S.fx('burst', { x: p.x, y: p.y, n: 26, speed: 300, color: '#ff2200' });
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
      S.wallsRect(p, W, H, 12, 0.4);
      if (st.t > 1200 && laserHit(st.t, p)) { die(st, p); continue; }
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

  function axisWalls(t, vert) {
    var walls = [];
    for (var i = 0; i < LASERS.length; i++) {
      if (LASERS[i].vert === vert) walls.push(laserPos(t, LASERS[i]));
    }
    walls.sort(function (a, b) { return a - b; });
    return walls;
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
      var d = AI.think(st, p, sk, { axisWalls: axisWalls, laserPos: laserPos, LASERS: LASERS });
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
    S.rrect(ctx, 10, 10, W - 20, H - 20, 12);
    ctx.stroke();

    for (var i = 0; i < LASERS.length; i++) {
      var L = LASERS[i];
      var pos = laserPos(view.t, L);
      var grd = L.vert
        ? ctx.createLinearGradient(pos, 0, pos, H)
        : ctx.createLinearGradient(0, pos, W, pos);
      grd.addColorStop(0, 'rgba(255,60,0,0.15)');
      grd.addColorStop(0.5, 'rgba(255,80,0,0.95)');
      grd.addColorStop(1, 'rgba(255,60,0,0.15)');
      ctx.strokeStyle = grd;
      ctx.lineWidth = THICK;
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      if (L.vert) { ctx.moveTo(pos, 8); ctx.lineTo(pos, H - 8); }
      else { ctx.moveTo(8, pos); ctx.lineTo(W - 8, pos); }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffaa00';
      ctx.font = '700 10px sans-serif';
      if (L.vert) {
        ctx.fillText('▲', pos - 4, 18);
        ctx.fillText('▼', pos - 4, H - 12);
      } else {
        ctx.fillText('◀', 12, pos + 4);
        ctx.fillText('▶', W - 20, pos + 4);
      }
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
    var prog = (now - t0) / 500;
    if (prog >= 1) return;
    var p = view.players[pid];
    var color = S.COLORS[(p.slot - 1) % 4];
    ctx.save();
    ctx.globalAlpha = 1 - prog;
    ctx.translate(p.x, p.y);
    ctx.rotate(prog * 3);
    ctx.scale(1 + prog, 1 + prog);
    S.shape(ctx, 0, 0, p.sh, 12, color);
    ctx.restore();
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
