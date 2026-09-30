(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['asteroidStorm'])
    || require('./asteroidStorm.ai.js');
  var W = 800, H = 600;
  var PHYS = { speed: 300, friction: 5, r: 11, w: W };

  var CONFIG = {
    id: 'asteroidStorm', name: 'Asteroid Storm', icon: '☄️',
    duration: 75, minPlayers: 2, maxPlayers: 4,
    description: 'Rocks rain from orbit with a one-second warning. Dash through the gaps and survive.',
    instructions: 'WASD or arrows to move, Space or Shift to dash. Watch the warning markers. Last one alive wins.',
    world: { w: W, h: H }
  };

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {}, en: {}, nid: 1, nx: 1200 };
    players.forEach(function (r, i) {
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: 160 + i * 160, y: H - 90, vx: 0, vy: 0, fx: 0, fy: -1,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0,
        dashT: 0, mem: {}
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
    S.fx('burst', { x: p.x, y: p.y, n: 22, speed: 220, color: '#ffaa00' });
    S.fx('shake', { mag: 3 });
  }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    st.nx -= dt;
    var interval = Math.max(430, 1350 - st.t * 0.011);
    if (st.nx <= 0) {
      st.nx = interval * (0.7 + Math.random() * 0.6);
      var id = st.nid++;
      st.en[id] = {
        id: id, x: 40 + Math.random() * (W - 80), y: -50,
        r: 13 + Math.random() * 20, w: 1, born: st.t,
        vx: (Math.random() - 0.5) * 70,
        vy: 0
      };
    }

    for (var eid in st.en) {
      var e = st.en[eid];
      if (e.w && st.t - e.born > 800) {
        e.w = 0;
        e.vy = 190 + Math.random() * 120 + st.t * 0.0035;
      }
      if (!e.w) {
        e.x += e.vx * d;
        e.y += e.vy * d;
      }
      if (e.y > H + 60) delete st.en[eid];
    }

    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.drive(p, d, PHYS);
      if (p.dashT > 0) p.dashT -= dt;
      if ((p.tp & 48) && p.dashT <= 0) {
        var dir = S.keysDir(p.tp) || { x: p.fx, y: p.fy };
        p.vx += dir.x * 420;
        p.vy += dir.y * 420;
        p.dashT = 1500;
        S.fx('burst', { x: p.x, y: p.y, n: 8, speed: 120 });
      }
      p.x = S.clamp(p.x, 14, W - 14);
      p.y = S.clamp(p.y, 14, H - 14);
      p.fx = Math.cos(Math.atan2(p.vy, p.vx));
      p.fy = Math.sin(Math.atan2(p.vy, p.vx));
      for (var eid2 in st.en) {
        var e2 = st.en[eid2];
        if (e2.w) continue;
        if (Math.hypot(p.x - e2.x, p.y - e2.y) < e2.r + 10) { die(st, p); break; }
      }
      if (p.al) p.sc = Math.floor(st.t / 1000);
      S.endInput(p);
    }
  }

  function checkWin(st) {
    var alive = [];
    for (var k in st.p) if (st.p[k].al) alive.push(Number(k));
    if (alive.length >= 2 && st.t < CONFIG.duration * 1000) return null;
    var rank = S.rank(st, 'sc');
    if (alive.length === 1) return { w: alive[0], reason: 'last-standing', rank: rank, sc: scores(st) };
    return { w: rank[0], reason: st.t >= CONFIG.duration * 1000 ? 'time' : 'void', rank: rank, sc: scores(st) };
  }

  function scores(st) {
    var o = {};
    for (var k in st.p) o[k] = st.p[k].sc;
    return o;
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: 0, p: {}, en: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      for (var e in st.en) full.en[e] = { x: Math.round(st.en[e].x), y: Math.round(st.en[e].y), r: Math.round(st.en[e].r), w: st.en[e].w };
      return full;
    }
    var d = { t: Math.round(st.t) };
    var ed = S.ed(st.en, last.en, ['x', 'y', 'r', 'w']);
    if (ed) d.en = ed;
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
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, W, H);
    for (var s = 0; s < 40; s++) {
      var sx = (s * 197 + 13) % W, sy = (s * 131 + 71) % H;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(sx, (sy + view.now / 90) % H, 1.5, 1.5);
    }

    var ids = Object.keys(view.en || {});
    ids.forEach(function (eid) {
      var e = view.en[eid];
      if (e.w) {
        var pulse = 0.35 + 0.4 * Math.sin(view.now / 70);
        ctx.fillStyle = 'rgba(255,68,0,' + pulse.toFixed(2) + ')';
        ctx.beginPath();
        ctx.moveTo(e.x - 12, 8);
        ctx.lineTo(e.x + 12, 8);
        ctx.lineTo(e.x, 32);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,68,0,0.35)';
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.moveTo(e.x, 34);
        ctx.lineTo(e.x, H);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(view.now / 400 + e.r);
      ctx.fillStyle = '#8a7a5a';
      ctx.strokeStyle = 'rgba(255,170,0,0.5)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur = 8;
      S.polyPath(ctx, 7, e.r, view.now / 400 + e.r);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.shadowBlur = 0;
    });

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 12, color);
      S.text(ctx, p.name + ' ' + (p.sc || 0), p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
