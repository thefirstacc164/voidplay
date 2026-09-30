(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['juggernaut'])
    || require('./juggernaut.ai.js');
  var CX = 400, CY = 300, R = 270;
  var JG = { speed: 235, friction: 3.2 };
  var RUN = { speed: 295, friction: 3.6 };
  var DASH = { power: 500, cd: 2200 };
  var RESPAWN = 2500;

  var CONFIG = {
    id: 'juggernaut', name: 'Juggernaut', icon: '🛡️',
    duration: 75, minPlayers: 2, maxPlayers: 4,
    description: 'The Juggernaut is heavy and slow but hits like a truck. Knock it off the edge to steal the crown.',
    instructions: 'Juggernaut scores over time. Bump it off the edge to become it. Space to dash. Most points wins.',
    world: { w: 800, h: 600 }
  };

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {}, jg: 0 };
    players.forEach(function (r, i) {
      var a = i / players.length * Math.PI * 2 + 0.6;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: CX + Math.cos(a) * 190, y: CY + Math.sin(a) * 190,
        vx: 0, vy: 0, fx: 1, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0,
        dcd: 0, dashT: 0, respT: 0, lastHit: 0, mem: {}
      };
    });
    var keys = Object.keys(st.p);
    st.jg = Number(keys[(Math.random() * keys.length) | 0]);
    return st;
  }

  function onInput(st, pid, input) {
    var p = st.p[String(pid)];
    if (p && p.al) S.latch(p, input.k);
  }

  function onPlayerLeft(st, pid) {
    var p = st.p[String(pid)];
    if (p && p.al) { p.al = 0; p.deathT = st.t; p.respT = 0; }
    if (st.jg === Number(pid)) crownRandom(st);
  }

  function crownRandom(st, prefer) {
    var pool = [];
    for (var k in st.p) if (st.p[k].al && Number(k) !== prefer) pool.push(Number(k));
    if (!pool.length) { st.jg = 0; return; }
    st.jg = pool[(Math.random() * pool.length) | 0];
  }

  function respawn(st, p) {
    var a = Math.random() * Math.PI * 2;
    p.x = CX + Math.cos(a) * 160;
    p.y = CY + Math.sin(a) * 160;
    p.vx = 0; p.vy = 0;
    p.al = 1; p.respT = 0;
    S.fx('burst', { x: p.x, y: p.y, n: 10, speed: 120 });
  }

  function knockout(st, p) {
    p.al = 0; p.deathT = st.t; p.respT = st.t + RESPAWN;
    S.fx('death', { x: p.x, y: p.y });
    S.fx('shake', { mag: 5 });
    if (Number(pidKey(st, p)) === st.jg && p.lastHit) {
      st.jg = p.lastHit;
      S.fx('burst', { x: st.p[String(st.jg)].x, y: st.p[String(st.jg)].y, n: 24, speed: 260, color: '#ff6600' });
    }
    p.lastHit = 0;
  }

  function pidKey(st, p) { for (var k in st.p) if (st.p[k] === p) return k; return '0'; }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    st.scd = (st.scd || 0) + d;
    var award = st.scd >= 1;
    if (award) st.scd -= 1;

    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) {
        if (p.respT && st.t >= p.respT) respawn(st, p);
        S.endInput(p);
        continue;
      }
      var isJg = Number(k) === st.jg;
      S.drive(p, d, isJg ? JG : RUN);
      if (!isJg) S.dash(p, DASH);
      S.tickCd(p, d);
      if (award && isJg) p.sc++;
      if (S.offCircle(p, CX, CY, R + 12)) knockout(st, p);
      else S.endInput(p);
    }

    var ids = Object.keys(st.p);
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = st.p[ids[i]], b = st.p[ids[j]];
        if (!a.al || !b.al) continue;
        var aJg = Number(ids[i]) === st.jg, bJg = Number(ids[j]) === st.jg;
        if (S.bounce(a, b, aJg ? 22 : 14, bJg ? 22 : 14, { e: 0.85, ma: aJg ? 3 : 1, mb: bJg ? 3 : 1 })) {
          if (aJg) { a.lastHit = Number(ids[j]); b.vx += (b.x - a.x) * 2.2; b.vy += (b.y - a.y) * 2.2; }
          if (bJg) { b.lastHit = Number(ids[i]); a.vx += (a.x - b.x) * 2.2; a.vy += (a.y - b.y) * 2.2; }
        }
      }
    }
  }

  function checkWin(st) {
    if (st.t < CONFIG.duration * 1000) return null;
    var ids = Object.keys(st.p).map(Number);
    ids.sort(function (a, b) { return st.p[b].sc - st.p[a].sc; });
    var sc = {};
    for (var k in st.p) sc[k] = st.p[k].sc;
    return { w: ids[0], reason: 'time', rank: ids, sc: sc };
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc', 'dcd', 'dashT'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: 0, jg: st.jg, p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    if (st.jg !== last.jg) d.jg = st.jg;
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
    ctx.strokeStyle = 'rgba(255,102,0,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, 6.2832);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,102,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(CX, CY, R + 14, 0, 6.2832);
    ctx.stroke();

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) { if (!view.players[pid].al) drawDead(ctx, view, pid, view.now); });
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var isJg = Number(pid) === view.jg;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      if (isJg) {
        ctx.globalAlpha = 0.2 + 0.08 * Math.sin(view.now / 200);
        ctx.fillStyle = '#ff6600';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 34, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      S.shape(ctx, p.x, p.y, p.sh, isJg ? 21 : 14, color);
      if (isJg) S.text(ctx, '👑', p.x, p.y - (isJg ? 36 : 28), { size: 15, glow: '#ff6600' });
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
    ctx.translate(p.x, p.y + prog * prog * 90);
    ctx.rotate(prog * 5);
    var s = 1 - prog * 0.8;
    ctx.scale(s, s);
    S.shape(ctx, 0, 0, p.sh, 14, color);
    ctx.restore();
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
