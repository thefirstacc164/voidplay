(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var CX = 400, CY = 300, R = 290, CORE = 34, COINS = 8;

  var CONFIG = {
    id: 'gravityWell', name: 'Gravity Well', icon: '🌑',
    duration: 60, minPlayers: 2, maxPlayers: 4,
    description: 'A dead star drags everyone toward the core. Scoop up coins without falling in.',
    instructions: 'Fight the pull, grab coins, avoid the core. Falling in costs half your coins. Most coins wins.',
    world: { w: 800, h: 600 }
  };

  var PHYS = { speed: 265, friction: 2.4 };

  function spawnCoin(st) {
    var a = Math.random() * Math.PI * 2;
    var r = 110 + Math.random() * 150;
    st.en[String(++st.eid)] = { id: st.eid, x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
  }

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {}, en: {}, eid: 0 };
    players.forEach(function (r, i) {
      var a = i / players.length * Math.PI * 2 + 0.6;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: CX + Math.cos(a) * 230, y: CY + Math.sin(a) * 230,
        vx: 0, vy: 0, fx: 1, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0, mem: {}
      };
    });
    for (var i = 0; i < COINS; i++) spawnCoin(st);
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
    S.fx('burst', { x: p.x, y: p.y, n: 24, speed: 260 });
    var drop = (p.sc / 2) | 0;
    for (var i = 0; i < drop && i < 8; i++) {
      var a = Math.random() * Math.PI * 2;
      var r = 110 + Math.random() * 140;
      st.en[String(++st.eid)] = { id: st.eid, x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
    }
    S.fx('shake', { mag: 5 });
  }

  function pull(st, p, d) {
    var dx = CX - p.x, dy = CY - p.y;
    var r = Math.hypot(dx, dy) || 1;
    var a = Math.min(24000 / Math.max(r, 30), 420);
    p.vx += dx / r * a * d;
    p.vy += dy / r * a * d;
  }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.drive(p, d, PHYS);
      pull(st, p, d);
      S.wallsCircle(p, CX, CY, R, 12, 0.4);
      if (S.dist(p.x, p.y, CX, CY) < CORE + 10) { die(st, p); continue; }
      S.endInput(p);
    }
    for (var oid in st.en) {
      var c = st.en[oid];
      var taken = false;
      for (var q in st.p) {
        var pl = st.p[q];
        if (!pl.al) continue;
        if (S.dist(pl.x, pl.y, c.x, c.y) < 24) {
          pl.sc++;
          taken = true;
          S.fx('burst', { x: c.x, y: c.y, n: 8, speed: 120, color: '#ffd700' });
          break;
        }
      }
      if (taken) delete st.en[oid];
    }
    var count = 0;
    for (var oid2 in st.en) count++;
    while (count < COINS) { spawnCoin(st); count++; }

    var ids = Object.keys(st.p);
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = st.p[ids[i]], b = st.p[ids[j]];
        if (a.al && b.al) S.bounce(a, b, 12, 12, { e: 0.7 });
      }
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
  var EF = ['x', 'y'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: 0, en: {}, p: {} };
      for (var oid in st.en) full.en[oid] = S.pd(st.en[oid], null, EF);
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    var ent = S.ed(st.en, last.en, EF);
    if (ent) d.en = ent;
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
      var r = S.dist(p.x, p.y, CX, CY);
      var ax = (p.x - CX) / (r || 1), ay = (p.y - CY) / (r || 1);
      if (r < 120) {
        p.aim = { x: ax, y: ay };
        continue;
      }
      var target = null, best = 1e9;
      for (var oid in st.en) {
        var c = st.en[oid];
        var cr = S.dist(c.x, c.y, CX, CY);
        if (cr < 100) continue;
        var dd = S.dist(p.x, p.y, c.x, c.y);
        if (dd < best) { best = dd; target = c; }
      }
      if (target) {
        var dx = target.x - p.x, dy = target.y - p.y;
        var l = Math.hypot(dx, dy) || 1;
        p.aim = { x: dx / l * 0.9 + ax * 0.55, y: dy / l * 0.9 + ay * 0.55 };
      } else p.aim = { x: ax, y: ay };
    }
  }

  function render(ctx, view, meId) {
    var g = ctx.createRadialGradient(CX, CY, 4, CX, CY, 120);
    g.addColorStop(0, 'rgba(255,0,228,0.55)');
    g.addColorStop(0.35, 'rgba(120,0,110,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(CX, CY, 120, 0, 6.2832);
    ctx.fill();

    ctx.fillStyle = '#0a0a0f';
    ctx.strokeStyle = '#ff00e4';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#ff00e4';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(CX, CY, CORE, 0, 6.2832);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(0,255,242,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, 6.2832);
    ctx.stroke();

    for (var oid in view.en) {
      var c = view.en[oid];
      ctx.globalAlpha = 0.9 + 0.1 * Math.sin(view.now / 180 + (c.x || 0));
      ctx.fillStyle = '#ffd700';
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 7, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) { if (!view.players[pid].al) drawDead(ctx, view, pid, view.now); });
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 12, color);
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
    var sx = p.x + (CX - p.x) * prog * prog;
    var sy = p.y + (CY - p.y) * prog * prog;
    ctx.save();
    ctx.globalAlpha = 1 - prog;
    ctx.translate(sx, sy);
    ctx.rotate(prog * 7);
    var s = 1 - prog * 0.7;
    ctx.scale(s, s);
    S.shape(ctx, 0, 0, p.sh, 12, color);
    ctx.restore();
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
