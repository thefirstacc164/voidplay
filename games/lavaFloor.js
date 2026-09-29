(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var W = 800, H = 1500, ROWS = 13, GAP = 108;
  var PHYS = { grav: 1400, jump: 620, speed: 300, friction: 6, r: 12, w: W };
  var BASE = 1560;

  var CONFIG = {
    id: 'lavaFloor', name: 'Lava Floor', icon: '🌋',
    duration: 90, minPlayers: 2, maxPlayers: 4,
    description: 'The floor is lava and it is rising. Climb the tower and outlive the heat.',
    instructions: 'A / D to move, Space to jump. Stay above the lava. Last one alive wins.',
    world: { w: W, h: H, cam: true }
  };

  function lavaY(t) {
    return BASE - (t * 0.011 + t * t * 0.00000001);
  }

  function plats(st) {
    if (!st._plats) {
      st._plats = S.genLadder(st.seed, ROWS, GAP, W, 95, 175);
      st._plats.push({ x: 12, y: 1452, w: W - 24 });
    }
    return st._plats;
  }

  function init(players) {
    var st = { t: 0, ph: 0, seed: (Math.random() * 1e9) | 0, p: {} };
    players.forEach(function (r, i) {
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: 130 + i * 170, y: 1418, vx: 0, vy: 0, fx: 0, fy: -1,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0,
        best: H, ground: 0, mem: {}
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
    S.fx('burst', { x: p.x, y: p.y, n: 24, speed: 240, color: '#ff4400' });
    S.fx('shake', { mag: 4 });
  }

  function tick(st, dt) {
    st.t += dt;
    var d = dt / 1000;
    var ly = lavaY(st.t);
    st.ly = ly;
    var list = plats(st);
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) { S.endInput(p); continue; }
      S.platStep(st, p, d, { grav: PHYS.grav, jump: PHYS.jump, speed: PHYS.speed, friction: PHYS.friction, r: PHYS.r, w: W, plats: list });
      if (p.y < 4) { p.y = 4; p.vy = Math.max(0, p.vy); }
      if (p.y < p.best) p.best = p.y;
      p.sc = Math.max(0, Math.round((BASE - p.best) / 10));
      if (p.y > ly - 6) { die(st, p); continue; }
      S.endInput(p);
    }
  }

  function checkWin(st) {
    var alive = [];
    for (var k in st.p) if (st.p[k].al) alive.push(Number(k));
    if (alive.length >= 2 && st.t < CONFIG.duration * 1000) return null;
    var rank = S.rank(st, 'best');
    if (alive.length === 1) return { w: alive[0], reason: 'last-standing', rank: rank, sc: scores(st) };
    return { w: rank[0], reason: st.t >= CONFIG.duration * 1000 ? 'time' : 'void', rank: rank, sc: scores(st) };
  }

  function scores(st) {
    var o = {};
    for (var k in st.p) o[k] = st.p[k].sc;
    return o;
  }

  var PF = ['x', 'y', 'vx', 'vy', 'al', 'sc', 'best', 'ground'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: st.seed, p: {} };
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    var ly = Math.round(lavaY(st.t) / 10);
    var lyLast = Math.round(lavaY(last.t) / 10);
    if (ly !== lyLast) d.ly = ly * 10;
    var pd = {};
    for (var key in st.p) {
      var f = S.pd(st.p[key], last.p[key], PF);
      if (f) pd[key] = f;
    }
    if (Object.keys(pd).length) d.p = pd;
    return d;
  }

  function bots(st) {
    var list = plats(st);
    var ly = lavaY(st.t);
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.bot || !p.al) continue;
      var danger = p.y > ly - 200;
      if (!p.ground) {
        var tgt = null;
        if (p.vy < 0 && p.mem.jx !== undefined) {
          tgt = p.mem.jx;
        } else {
          var bd = 1e9, bx = 0;
          for (var i = 0; i < list.length; i++) {
            var pl = list[i];
            if (pl.y <= p.y + 4 || pl.y > ly - 30) continue;
            var near2 = S.clamp(p.x, pl.x + 14, pl.x + pl.w - 14);
            var d2 = (pl.y - p.y) + Math.abs(near2 - p.x) * 1.2;
            if (d2 < bd) { bd = d2; bx = near2; }
          }
          if (bd < 1e9) tgt = bx;
        }
        if (tgt !== null) p.aim = { x: S.clamp((tgt - p.x) / 30, -1, 1), y: 0 };
        continue;
      }
      p.mem.jx = undefined;
      var above = null, best = 1e9;
      for (var i = 0; i < list.length; i++) {
        var pl = list[i];
        if (pl.y >= p.y - 10) continue;
        var dy = p.y - pl.y;
        if (dy > 160) continue;
        var near = S.clamp(p.x, pl.x + 14, pl.x + pl.w - 14);
        var dx = near - p.x;
        var score = Math.abs(dx) * 0.9 + dy * 0.5 + Math.random() * 26 - (danger ? 40 : 0);
        if (score < best) { best = score; above = { near: near, dy: dy }; }
      }
      if (above) {
        var dx2 = above.near - p.x;
        p.aim = { x: S.clamp(dx2 / 40, -1, 1), y: 0 };
        if (Math.abs(dx2) < 40 && above.dy <= 165 && Math.abs(p.vx) < 160 && Math.random() < (danger ? 0.75 : 0.5)) {
          p.tp |= 16;
          p.mem.jx = above.near;
        }
      } else {
        p.aim = { x: Math.sin(st.t / 600 + p.slot * 2) * 0.6, y: 0 };
        if (Math.random() < 0.015) p.tp |= 16;
      }
      var cur = null;
      for (var ci = 0; ci < list.length; ci++) {
        var cp = list[ci];
        if (Math.abs(p.y - cp.y) < 7 && p.x > cp.x - 6 && p.x < cp.x + cp.w + 6) { cur = cp; break; }
      }
      if (cur && p.aim.x) {
        var room = p.aim.x > 0 ? cur.x + cur.w - 16 - p.x : p.x - (cur.x + 16);
        if (room < 64) p.aim.x *= Math.max(0, room / 64);
      }

    }
  }

  function render(ctx, view, meId) {
    var list = plats({ seed: view.seed });
    var ly = view.ly !== undefined ? view.ly : lavaY(view.t);
    var camY = ly + 380 - 600;
    for (var pid0 in view.players) {
      if (String(pid0) === String(meId) && view.players[pid0].al) camY = view.players[pid0].y - 330;
    }
    camY = S.clamp(camY, ly - 80, H - 600);

    ctx.save();
    ctx.translate(0, -camY);

    var from = Math.max(0, ((camY - 100) / GAP) | 0);
    var to = Math.min(list.length, ((camY + 700) / GAP) | 0);
    for (var i = from; i < to; i++) {
      var pl = list[i];
      ctx.fillStyle = 'rgba(255,102,0,0.06)';
      S.rrect(ctx, pl.x, pl.y, pl.w, 10, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,150,60,0.55)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#ff6600';
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 12, color);
      S.text(ctx, p.name, p.x, p.y - 26, { size: 10, glow: color, blur: 6 });
    });

    var lg = ctx.createLinearGradient(0, ly, 0, ly + 260);
    lg.addColorStop(0, 'rgba(255,80,0,0.95)');
    lg.addColorStop(0.15, 'rgba(255,40,0,0.75)');
    lg.addColorStop(1, 'rgba(120,0,0,0.35)');
    ctx.fillStyle = lg;
    ctx.fillRect(-10, ly, W + 20, 900);
    for (var b = 0; b < 7; b++) {
      var bx = ((view.now / 22 + b * 137) % (W + 80)) - 40;
      var by = ly - Math.abs(Math.sin(view.now / 300 + b * 1.7)) * 26;
      ctx.fillStyle = 'rgba(255,200,60,0.8)';
      ctx.beginPath();
      ctx.arc(bx, by, 3 + (b % 3), 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
