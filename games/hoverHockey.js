(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var W = 800, H = 600;
  var G_TOP = 235, G_BOT = 365;
  var PHYS = { speed: 380, friction: 6, r: 15, w: W };

  var CONFIG = {
    id: 'hoverHockey', name: 'Hover Hockey', icon: '🏒',
    duration: 120, minPlayers: 2, maxPlayers: 4,
    description: 'Two-on-two hover puck. Slots 1 and 3 defend the left goal, 2 and 4 the right. First to five.',
    instructions: 'WASD or arrows to move. Bump the puck into the opposing goal. First team to 5 wins.',
    world: { w: W, h: H }
  };

  function teamOf(slot) { return (slot - 1) % 2; }

  function resetPuck(st, dirFlag) {
    st.puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    st.freeze = 500;
    if (dirFlag) {
      var ang = (Math.random() - 0.5) * 0.8;
      var dir = Math.random() < 0.5 ? 1 : -1;
      st.puck.vx = Math.cos(ang) * 240 * dir;
      st.puck.vy = Math.sin(ang) * 240;
    }
  }

  function init(players) {
    var st = { t: 0, ph: 1, seed: 0, p: {}, sc: [0, 0] };
    players.forEach(function (r, i) {
      var tm = teamOf(r.s);
      var side = tm === 0 ? 1 : -1;
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: W / 2 - side * 190 + (i % 2) * side * -70, y: H / 2 + (i % 2 ? 90 : -90),
        vx: 0, vy: 0, fx: -side, fy: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0,
        team: tm, mem: {}
      };
    });
    resetPuck(st, 0);
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

  function goal(st, scorer) {
    st.sc[scorer]++;
    for (var k in st.p) {
      if (teamOf(st.p[k].slot) === scorer) st.p[k].sc = st.sc[scorer];
    }
    S.fx('burst', { x: scorer === 0 ? W - 30 : 30, y: H / 2, n: 34, speed: 340, color: scorer === 0 ? '#ff0099' : '#00fff2' });
    S.fx('shake', { mag: 5 });
    resetPuck(st, 1);
  }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    if (st.freeze > 0) st.freeze -= dt;
    var pk = st.puck;

    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.drive(p, d, PHYS);
      p.x = S.clamp(p.x, 20, W - 20);
      p.y = S.clamp(p.y, 20, H - 20);
      S.endInput(p);
    }

    if (st.freeze <= 0) {
      var keys = Object.keys(st.p);
      for (var a = 0; a < keys.length; a++) {
        for (var b = a + 1; b < keys.length; b++) {
          S.bounce(st.p[keys[a]], st.p[keys[b]], 15, 15, 0.5);
        }
      }
      for (var kk in st.p) {
        S.bounce(st.p[kk], pk, 15, 11, 0.92, 0.55);
      }

      pk.x += pk.vx * d;
      pk.y += pk.vy * d;
      var sp = Math.hypot(pk.vx, pk.vy);
      if (sp > 760) { pk.vx *= 760 / sp; pk.vy *= 760 / sp; }
      var drag = Math.exp(-0.25 * d);
      pk.vx *= drag;
      pk.vy *= drag;

      if (pk.y < 14) { pk.y = 14; pk.vy = Math.abs(pk.vy) * 0.86; }
      if (pk.y > H - 14) { pk.y = H - 14; pk.vy = -Math.abs(pk.vy) * 0.86; }
      var inMouth = pk.y > G_TOP && pk.y < G_BOT;
      if (pk.x < 14) {
        if (inMouth) { if (pk.x < -2) { goal(st, 1); return; } }
        else { pk.x = 14; pk.vx = Math.abs(pk.vx) * 0.86; }
      }
      if (pk.x > W - 14) {
        if (inMouth) { if (pk.x > W + 2) { goal(st, 0); return; } }
        else { pk.x = W - 14; pk.vx = -Math.abs(pk.vx) * 0.86; }
      }
    }
  }

  function checkWin(st) {
    var timeUp = st.t >= CONFIG.duration * 1000;
    if (st.sc[0] >= 5 || st.sc[1] >= 5 || timeUp) {
      var winner = st.sc[0] === st.sc[1] ? -1 : (st.sc[0] > st.sc[1] ? 0 : 1);
      var rank = [];
      for (var k in st.p) if (teamOf(st.p[k].slot) === winner) rank.push(Number(k));
      for (var k2 in st.p) if (teamOf(st.p[k2].slot) !== winner) rank.push(Number(k2));
      var w = rank.length ? rank[0] : -1;
      return { w: w, reason: 'goals', rank: rank, sc: scores(st) };
    }
    return null;
  }

  function scores(st) {
    var o = {};
    for (var k in st.p) o[k] = st.p[k].sc;
    return o;
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 1, seed: 0, sc: st.sc.slice(), fz: Math.round(st.freeze), pk: [Math.round(st.puck.x), Math.round(st.puck.y)], p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    if (!last.sc || st.sc[0] !== last.sc[0] || st.sc[1] !== last.sc[1]) d.sc = st.sc.slice();
    if (Math.round(st.freeze / 50) !== Math.round((last.freeze || 0) / 50)) d.fz = Math.round(st.freeze);
    var px = Math.round(st.puck.x), py = Math.round(st.puck.y);
    if (!last.puck || Math.abs(px - Math.round(last.puck.x)) > 1 || Math.abs(py - Math.round(last.puck.y)) > 1) d.pk = [px, py];
    var pd = {};
    for (var key in st.p) {
      var f = S.pd(st.p[key], last.p[key], PF);
      if (f) pd[key] = f;
    }
    if (Object.keys(pd).length) d.p = pd;
    return d;
  }

  function bots(st) {
    var pk = st.puck;
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.bot || !p.al) continue;
      var gx = p.team === 0 ? W - 26 : 26;
      var behind = { x: pk.x + (p.team === 0 ? -26 : 26), y: pk.y };
      var dx = behind.x - p.x, dy = behind.y - p.y;
      var dd = Math.hypot(dx, dy) || 1;
      if (dd < 30) {
        p.aim = { x: (gx - p.x) / 200, y: (H / 2 - p.y) / 300 };
      } else {
        p.aim = { x: dx / dd + Math.sin(st.t / 700 + p.slot * 2.3) * 0.2, y: dy / dd };
      }
      p.aim.y += (H / 2 - p.y) / 900;
    }
  }

  function render(ctx, view, meId) {
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(0,255,242,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.beginPath();
    ctx.moveTo(W / 2, 8);
    ctx.lineTo(W / 2, H - 8);
    ctx.stroke();
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = 'rgba(0,255,242,0.18)';
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 70, 0, 6.2832);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = 6;
    ctx.shadowBlur = 16;
    ctx.shadowColor = '#ff0099';
    ctx.strokeStyle = '#ff0099';
    ctx.beginPath();
    ctx.moveTo(9, G_TOP);
    ctx.lineTo(9, G_BOT);
    ctx.stroke();
    ctx.shadowColor = '#00fff2';
    ctx.strokeStyle = '#00fff2';
    ctx.beginPath();
    ctx.moveTo(W - 9, G_TOP);
    ctx.lineTo(W - 9, G_BOT);
    ctx.stroke();
    ctx.shadowBlur = 0;

    var sc = view.sc || [0, 0];
    S.text(ctx, String(sc[0]), W / 2 - 70, 60, { size: 40, glow: '#ff0099', color: '#ff0099' });
    S.text(ctx, String(sc[1]), W / 2 + 70, 60, { size: 40, glow: '#00fff2', color: '#00fff2' });

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = p.team === 0 ? '#ff0099' : '#00fff2';
      var slotColor = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(view.now / 700 + p.slot);
      S.shape(ctx, 0, 0, p.sh, 14, color);
      ctx.restore();
      S.shape(ctx, p.x, p.y, 'ci', 5, slotColor);
      S.text(ctx, p.name, p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });

    var pk = view.pk || { x: W / 2, y: H / 2 };
    ctx.save();
    ctx.translate(pk.x, pk.y);
    ctx.rotate(view.now / 150);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 18;
    S.polyPath(ctx, 6, 11, view.now / 150);
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;

    if ((view.fz || 0) > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, 0, W, H);
      S.text(ctx, 'GET READY', W / 2, H / 2 - 100, { size: 26, glow: '#ffffff' });
    }
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
