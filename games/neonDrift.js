(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['neonDrift'])
    || require('./neonDrift.ai.js');
  var W = 1700, H = 1300;
  var CX = 850, CY = 650, RX = 620, RY = 430;
  var NWP = 24, LAPS = 4, HALF = 50;
  var MAXSP = 430, BOOST_SP = 620;

  var CONFIG = {
    id: 'neonDrift', name: 'Neon Drift', icon: '🏎️',
    duration: 100, minPlayers: 2, maxPlayers: 4,
    description: 'A 24-point oval circuit built for drifting. Three laps, boost pads, no brakes on friendship.',
    instructions: 'W / S throttle, A / D steer, Shift to drift. Hit the glowing pads for boost. Three laps first.',
    world: { w: W, h: H, cam: true }
  };

  var TRACK = [];
  (function () {
    for (var i = 0; i < NWP; i++) {
      var a = i / NWP * Math.PI * 2 - Math.PI / 2;
      TRACK.push({ x: CX + Math.cos(a) * RX, y: CY + Math.sin(a) * RY });
    }
  })();

  function segInfo(x, y) {
    var bd = 1e9, bx = 0, by = 0;
    for (var i = 0; i < NWP; i++) {
      var a = TRACK[i], b = TRACK[(i + 1) % NWP];
      var abx = b.x - a.x, aby = b.y - a.y;
      var t = ((x - a.x) * abx + (y - a.y) * aby) / (abx * abx + aby * aby);
      t = S.clamp(t, 0, 1);
      var px = a.x + abx * t, py = a.y + aby * t;
      var dd = Math.hypot(x - px, y - py);
      if (dd < bd) { bd = dd; bx = px; by = py; }
    }
    return { d: bd, x: bx, y: by };
  }

  function init(players) {
    var st = { t: 0, ph: 1, seed: 0, p: {} };
    players.forEach(function (r, i) {
      var at = (NWP - 1 - i + NWP) % NWP;
      var pt = TRACK[at];
      var nx = TRACK[(at + 1) % NWP];
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: pt.x, y: pt.y, vx: 0, vy: 0, fx: 1, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0,
        h: Math.atan2(nx.y - pt.y, nx.x - pt.x), sp: 0, wp: (at + 1) % NWP, lap: 0, fin: 0, boost: 0, mem: {}
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
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al || p.fin) { S.endInput(p); continue; }
      var up = p.tp & 1, down = p.tp & 2, left = p.tp & 4, right = p.tp & 8, drift = p.tp & 16;
      var maxsp = p.boost > 0 ? BOOST_SP : MAXSP;
      if (p.boost > 0) p.boost -= dt;
      if (up) p.sp += 420 * d;
      else if (down) p.sp -= 560 * d;
      else p.sp -= Math.sign(p.sp) * 120 * d;
      if (p.sp > maxsp) p.sp = maxsp;
      if (p.sp < -140) p.sp = -140;
      if (Math.abs(p.sp) < 4 && !up && !down) p.sp = 0;

      var steer = (right ? 1 : 0) - (left ? 1 : 0);
      var grip = drift ? 1.9 : 7.5;
      var turn = steer * 2.5 * S.clamp(p.sp / 150, -1, 1) * (drift ? 1.55 : 1);
      p.h += turn * d;
      var tvx = Math.cos(p.h) * p.sp, tvy = Math.sin(p.h) * p.sp;
      var blend = 1 - Math.exp(-grip * d);
      p.vx += (tvx - p.vx) * blend;
      p.vy += (tvy - p.vy) * blend;
      p.x += p.vx * d;
      p.y += p.vy * d;

      if (p.x < 16) { p.x = 16; p.vx = Math.abs(p.vx) * 0.4; }
      if (p.x > W - 16) { p.x = W - 16; p.vx = -Math.abs(p.vx) * 0.4; }
      if (p.y < 16) { p.y = 16; p.vy = Math.abs(p.vy) * 0.4; }
      if (p.y > H - 16) { p.y = H - 16; p.vy = -Math.abs(p.vy) * 0.4; }

      var si = segInfo(p.x, p.y);
      if (si.d > HALF) {
        var ux = (si.x - p.x) / (si.d || 1), uy = (si.y - p.y) / (si.d || 1);
        p.x = si.x - ux * HALF;
        p.y = si.y - uy * HALF;
        p.vx += ux * 230;
        p.vy += uy * 230;
        p.sp *= 0.88;
      }

      var nxt = TRACK[p.wp % NWP];
      if (Math.hypot(p.x - nxt.x, p.y - nxt.y) < 84) {
        if (p.wp % 6 === 0) p.boost = 1100;
        p.wp++;
        if (p.wp % NWP === 0) {
          p.lap++;
          if (p.lap >= LAPS && !p.fin) {
            p.fin = st.t;
            S.fx('burst', { x: p.x, y: p.y, n: 30, speed: 300 });
          }
        }
      }
      p.sc = p.lap * NWP + p.wp;
      S.endInput(p);
    }
    var keys = Object.keys(st.p);
    for (var a = 0; a < keys.length; a++) {
      for (var b = a + 1; b < keys.length; b++) {
        S.bounce(st.p[keys[a]], st.p[keys[b]], 15, 15, 0.55);
      }
    }
  }

  function checkWin(st) {
    var finished = [];
    for (var k in st.p) if (st.p[k].fin) finished.push(Number(k));
    if (finished.length) {
      finished.sort(function (a, b) { return st.p[a].fin - st.p[b].fin; });
      var rank = finished.concat(S.rank(st, 'sc').filter(function (k) { return st.p[k] && !st.p[k].fin; }));
      return { w: finished[0], reason: 'finish', rank: rank, sc: scores(st) };
    }
    if (st.t < CONFIG.duration * 1000) return null;
    var rank2 = S.rank(st, 'sc');
    return { w: rank2[0], reason: 'time', rank: rank2, sc: scores(st) };
  }

  function scores(st) {
    var o = {};
    for (var k in st.p) o[k] = st.p[k].sc;
    return o;
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc', 'wp', 'lap', 'fin', 'boost'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 1, seed: 0, p: {} };
      for (var k in st.p) {
        var f = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
        f.h = Math.round(st.p[k].h * 100) / 100;
        full.p[k] = f;
      }
      return full;
    }
    var d = { t: Math.round(st.t) };
    var pd = {};
    for (var key in st.p) {
      var g = S.pd(st.p[key], last.p[key], PF);
      if (g) {
        if (Math.round(st.p[key].h * 50) !== Math.round((last.p[key].h || 0) * 50)) g.h = Math.round(st.p[key].h * 100) / 100;
        pd[key] = g;
      }
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
      var d = AI.think(st, p, sk, { TRACK: TRACK, NWP: NWP });
      if (!d) { p.aim = null; continue; }
      p.aim = d.aim !== undefined ? d.aim : null;
      if (d.k) S.latch(p, d.k);
      if (d.tap) p.tp |= 16;
      if (d.tp !== undefined) p.tp = d.tp;
    }
  }

  function render(ctx, view, meId) {
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, view.w || W, view.h || H);
    var camX = 0, camY = 0;
    for (var pid0 in view.players) {
      if (String(pid0) === String(meId)) {
        camX = view.players[pid0].x - (view.w || W) / 2;
        camY = view.players[pid0].y - (view.h || H) / 2;
      }
    }
    camX = S.clamp(camX, 0, W - (view.w || W));
    camY = S.clamp(camY, 0, H - (view.h || H));
    ctx.save();
    ctx.translate(-camX, -camY);

    for (var pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      for (var i = 0; i <= NWP; i++) {
        var pt = TRACK[i % NWP];
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = pass === 0 ? 'rgba(255,0,153,0.10)' : pass === 1 ? 'rgba(255,0,153,0.5)' : 'rgba(0,255,242,0.6)';
      ctx.lineWidth = [HALF * 2 + 14, HALF * 2, 3][pass];
      if (pass === 2) ctx.setLineDash([16, 20]);
      if (pass === 0) { ctx.shadowColor = '#ff0099'; ctx.shadowBlur = 24; }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    }

    for (var pI = 0; pI < NWP; pI += 6) {
      var pad = TRACK[pI];
      var boostPulse = 0.55 + 0.35 * Math.sin(view.now / 160 + pI);
      ctx.fillStyle = 'rgba(57,255,20,' + boostPulse.toFixed(2) + ')';
      ctx.shadowColor = '#39ff14';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 24, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7,7,15,0.8)';
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, 14, 0, 6.2832);
      ctx.fill();
    }

    var pids = Object.keys(view.players);
    pids.sort(function (a, b) { return (view.players[b].lap || 0) - (view.players[a].lap || 0); });
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      var h = p.h || 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(h);
      if (String(pid) === String(meId)) S.meRing(ctx, 0, 0, color, view.now);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      S.rrect(ctx, -14, -9, 28, 18, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7,7,15,0.85)';
      S.rrect(ctx, -4, -7, 10, 14, 3);
      ctx.fill();
      if (p.boost > 0) {
        ctx.fillStyle = '#39ff14';
        ctx.fillRect(-20, -4, 8, 8);
      }
      ctx.restore();
      S.text(ctx, p.name + ' L' + (p.lap || 0), p.x, p.y - 24, { size: 10, glow: color, blur: 6 });
    });
    ctx.restore();
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
