(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var CX = 400, CY = 300, R = 265;
  var PHYS = { speed: 280, friction: 3.6 };
  var PASS_CD = 800;

  var CONFIG = {
    id: 'bombTag', name: 'Bomb Tag', icon: '💣',
    duration: 75, minPlayers: 2, maxPlayers: 4,
    description: 'Someone is holding a bomb. Pass it by touching them before the fuse burns out.',
    instructions: 'Touch another player to pass the bomb. If it blows up on you, you are out. Last one alive wins.',
    world: { w: 800, h: 600 }
  };

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {}, bomb: 0, fuse: 0, passCd: 0 };
    players.forEach(function (r, i) {
      var a = i / players.length * Math.PI * 2 + 0.6;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: CX + Math.cos(a) * 180, y: CY + Math.sin(a) * 180,
        vx: 0, vy: 0, fx: 1, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0, mem: {}
      };
    });
    var keys = Object.keys(st.p);
    st.bomb = Number(keys[(Math.random() * keys.length) | 0]);
    st.fuse = 8000 + Math.random() * 6000;
    return st;
  }

  function onInput(st, pid, input) {
    var p = st.p[String(pid)];
    if (p && p.al) S.latch(p, input.k);
  }

  function onPlayerLeft(st, pid) {
    var p = st.p[String(pid)];
    if (p && p.al) { p.al = 0; p.deathT = st.t; }
    if (st.bomb === Number(pid)) passBomb(st);
  }

  function aliveIds(st) {
    var out = [];
    for (var k in st.p) if (st.p[k].al) out.push(Number(k));
    return out;
  }

  function passBomb(st) {
    var alive = aliveIds(st);
    if (!alive.length) { st.bomb = 0; return; }
    var pool = alive.filter(function (id) { return id !== st.bomb; });
    var list = pool.length ? pool : alive;
    st.bomb = list[(Math.random() * list.length) | 0];
    st.fuse = 8000 + Math.random() * 6000;
    st.passCd = PASS_CD;
  }

  function explode(st) {
    var p = st.p[String(st.bomb)];
    if (p && p.al) {
      p.al = 0; p.deathT = st.t;
      S.fx('burst', { x: p.x, y: p.y, n: 40, speed: 320, color: '#ff6600' });
      S.fx('shake', { mag: 8 });
      S.fx('death', { x: p.x, y: p.y });
    }
    passBomb(st);
  }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    st.fuse -= dt;
    if (st.passCd > 0) st.passCd -= dt;
    if (st.fuse <= 0) explode(st);

    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.drive(p, d, PHYS);
      S.wallsCircle(p, CX, CY, R, 14, 0.6);
      S.endInput(p);
    }

    var holder = st.p[String(st.bomb)];
    if (holder && holder.al && st.passCd <= 0) {
      for (var q in st.p) {
        var o = st.p[q];
        if (!o.al || o === holder) continue;
        if (S.dist(holder.x, holder.y, o.x, o.y) < 32) {
          st.bomb = Number(q);
          st.passCd = PASS_CD;
          S.fx('burst', { x: o.x, y: o.y, n: 10, speed: 140, color: '#ff6600' });
        }
      }
    }

    var ids = Object.keys(st.p);
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = st.p[ids[i]], b = st.p[ids[j]];
        if (a.al && b.al) S.bounce(a, b, 14, 14, { e: 0.8 });
      }
    }
  }

  function checkWin(st) {
    var alive = aliveIds(st);
    if (alive.length >= 2 && st.t < CONFIG.duration * 1000) return null;
    if (alive.length === 1) return { w: alive[0], reason: 'last-standing', rank: S.rank(st) };
    return { w: null, reason: st.t >= CONFIG.duration * 1000 ? 'time' : 'void', rank: S.rank(st) };
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: 0, bo: st.bomb, p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr', 'sc']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    if (st.bomb !== last.bomb) d.bo = st.bomb;
    if (Math.round(st.fuse / 200) !== Math.round(last.fuse / 200)) d.fu = Math.round(st.fuse / 200) * 200;
    var pd = {};
    for (var key in st.p) {
      var f = S.pd(st.p[key], last.p[key], PF);
      if (f) pd[key] = f;
    }
    if (Object.keys(pd).length) d.p = pd;
    return d;
  }

  function bots(st) {
    var holder = st.p[String(st.bomb)];
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.bot || !p.al) continue;
      if (p === holder) {
        var target = null, best = 1e9;
        for (var q in st.p) {
          var o = st.p[q];
          if (!o.al || o === p) continue;
          var dd = S.dist(p.x, p.y, o.x, o.y);
          if (dd < best) { best = dd; target = o; }
        }
        if (target) {
          var dx = target.x - p.x, dy = target.y - p.y;
          var l = Math.hypot(dx, dy) || 1;
          p.aim = { x: dx / l, y: dy / l };
        }
      } else if (holder && holder.al) {
        var dx2 = p.x - holder.x, dy2 = p.y - holder.y;
        var l2 = Math.hypot(dx2, dy2) || 1;
        p.aim = { x: dx2 / l2, y: dy2 / l2 };
        var mx = p.x + p.aim.x * 70, my = p.y + p.aim.y * 70;
        var dc = S.dist(mx, my, CX, CY);
        if (dc > R - 40) p.aim = { x: (CX - p.x) / 200, y: (CY - p.y) / 200 };
      } else p.aim = null;
    }
  }

  function render(ctx, view, meId) {
    ctx.strokeStyle = 'rgba(255,102,0,0.4)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff6600';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, 6.2832);
    ctx.stroke();
    ctx.shadowBlur = 0;

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) { if (!view.players[pid].al) drawDead(ctx, view, pid, view.now); });
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 14, color);
      S.text(ctx, p.name, p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });

    var holder = view.players[String(view.bo)];
    if (holder && holder.al) {
      var frac = Math.max(0, Math.min(1, (view.fu === undefined ? 3000 : view.fu) / 14000));
      var pulse = 0.5 + 0.5 * Math.sin(view.now / (90 + frac * 160));
      var glow = ctx.createRadialGradient(holder.x, holder.y, 4, holder.x, holder.y, 36 + 8 * pulse);
      glow.addColorStop(0, 'rgba(255,102,0,' + (0.36 + 0.24 * pulse).toFixed(2) + ')');
      glow.addColorStop(1, 'rgba(255,102,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(holder.x, holder.y, 36 + 8 * pulse, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,102,0,0.22)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(holder.x, holder.y, 27, 0, 6.2832);
      ctx.stroke();
      var col = frac < 0.3 ? '#ff2200' : '#ff8800';
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(holder.x, holder.y, 27, -Math.PI / 2, -Math.PI / 2 + frac * 6.2832);
      ctx.stroke();
      ctx.shadowBlur = 0;
      var bob = Math.sin(view.now / 180) * 3;
      S.text(ctx, '💣', holder.x, holder.y - 50 + bob, { size: 22, glow: col, blur: 12 });
      S.text(ctx, 'HAS THE BOMB', holder.x, holder.y + 36, { size: 9, glow: col, blur: 6 });
    }
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
