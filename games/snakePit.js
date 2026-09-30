(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var AI = (typeof self !== 'undefined' && self.VP && self.VP.AI && self.VP.AI['snakePit'])
    || require('./snakePit.ai.js');
  var COLS = 32, ROWS = 24, CELL = 25;
  var STEP_MS = 110, ORBS = 6, START_LEN = 4;
  var SPAWNS = [[6, 6, 3], [25, 6, 1], [6, 17, 3], [25, 17, 1]];

  var CONFIG = {
    id: 'snakePit', name: 'Snake Pit', icon: '🐍',
    duration: 60, minPlayers: 2, maxPlayers: 4,
    description: 'Classic snake, everyone in one pit. Grab orbs, grow, and cut off your rivals.',
    instructions: 'Arrows / WASD to steer. Eat orbs to grow. Hit a wall, a tail, or yourself and you are out.',
    world: { w: 800, h: 600 }
  };

  function px(g) { return g * CELL + CELL / 2; }

  function orbCells(st) {
    var set = {};
    for (var oid in st.en) set[st.en[oid].g] = 1;
    return set;
  }

  function spawnOrb(st) {
    var r = S.rng((st.seed + st.t * 7919 + st.eid) | 0);
    var orbs = orbCells(st);
    for (var tries = 0; tries < 80; tries++) {
      var g = (r() * COLS * ROWS) | 0;
      if (st.occ[g]) continue;
      var ok = true;
      for (var k in st.p) {
        if (st.p[k].al && st.p[k].body[0] === g) { ok = false; break; }
      }
      if (ok) {
        st.en[String(++st.eid)] = { id: st.eid, g: g };
        st.occ[g] = 1;
        return;
      }
    }
  }

  function init(players) {
    var st = { t: 0, ph: 0, seed: (Math.random() * 1e9) | 0, p: {}, en: {}, eid: 0, occ: {}, stepT: 0 };
    players.forEach(function (pl) {
      var sp = SPAWNS[(pl.s - 1) % 4];
      var body = [];
      for (var i = 0; i < START_LEN; i++) body.push(sp[1] * COLS + sp[0] - i * sp[2]);
      st.p[String(pl.i)] = {
        name: pl.n, slot: pl.s, sh: pl.sh || 'sq', tr: pl.tr || 't0', bot: pl.bot ? 1 : 0,
        x: px(sp[0]), y: px(sp[1]),
        d: sp[2] === 1 ? 2 : 3, nd: -1,
        body: body, ln: START_LEN, grow: 0,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: START_LEN, mem: {}
      };
      body.forEach(function (g) { st.occ[g] = 1; });
    });
    for (var o = 0; o < ORBS; o++) spawnOrb(st);
    return st;
  }

  function steer(p) {
    var want = S.dirFromKeys(p.tp);
    if (want < 0) want = S.dirFromKeys(p.k);
    if (want < 0) return;
    if (p.d === 0 && want === 1) return;
    if (p.d === 1 && want === 0) return;
    if (p.d === 2 && want === 3) return;
    if (p.d === 3 && want === 2) return;
    p.nd = want;
  }

  function onInput(st, pid, input) {
    var p = st.p[String(pid)];
    if (p && p.al) {
      S.latch(p, input.k);
      steer(p);
    }
  }

  function onPlayerLeft(st, pid) {
    var p = st.p[String(pid)];
    if (p && p.al) {
      p.al = 0; p.deathT = st.t;
      p.body.forEach(function (g) { delete st.occ[g]; });
    }
  }

  function die(st, p) {
    p.al = 0; p.deathT = st.t;
    p.body.forEach(function (g) { delete st.occ[g]; });
    S.fx('death', { x: p.x, y: p.y });
    S.fx('burst', { x: p.x, y: p.y, n: 22, speed: 220 });
    S.fx('shake', { mag: 3 });
  }

  function step(st) {
    var heads = {};
    for (var k in st.p) {
      var p = st.p[k];
      if (!p.al) continue;
      steer(p);
      if (p.nd >= 0) { p.d = p.nd; p.nd = -1; }
      var hx = p.body[0] % COLS, hy = (p.body[0] / COLS) | 0;
      var nx = hx + S.DIRX[p.d], ny = hy + S.DIRY[p.d];
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { die(st, p); continue; }
      var g = ny * COLS + nx;
      var clash = false;
      for (var q in st.p) {
        var o = st.p[q];
        if (!o.al) continue;
        for (var i = 0; i < o.body.length; i++) {
          if (o === p && i === o.body.length - 1 && p.grow === 0) continue;
          if (o.body[i] === g) { clash = true; break; }
        }
        if (clash) break;
      }
      if (clash) { die(st, p); continue; }
      heads[k] = g;
    }

    for (var key in heads) {
      var pl = st.p[key];
      var g2 = heads[key];
      pl.body.unshift(g2);
      st.occ[g2] = 1;
      if (pl.grow > 0) {
        pl.grow--;
      } else {
        var tail = pl.body.pop();
        var still = false;
        for (var q2 in st.p) {
          if (st.p[q2].al && st.p[q2].body.indexOf(tail) >= 0) { still = true; break; }
        }
        if (!still) delete st.occ[tail];
      }
      pl.ln = pl.body.length;
      pl.sc = pl.ln;
      pl.x = px(g2 % COLS);
      pl.y = px((g2 / COLS) | 0);

      for (var oid in st.en) {
        if (st.en[oid].g === g2) {
          delete st.occ[g2];
          delete st.en[oid];
          pl.grow += 2;
          S.fx('burst', { x: px(g2 % COLS), y: px((g2 / COLS) | 0), n: 8, speed: 120 });
          spawnOrb(st);
        }
      }
    }
  }

  function tick(st, dt) {
    st.t += dt;
    st.stepT += dt;
    while (st.stepT >= STEP_MS) {
      st.stepT -= STEP_MS;
      step(st);
    }
    for (var k in st.p) S.endInput(st.p[k]);
  }

  function checkWin(st) {
    var alive = [];
    for (var k in st.p) if (st.p[k].al) alive.push(Number(k));
    if (alive.length >= 2 && st.t < CONFIG.duration * 1000) return null;
    var rank = S.rank(st, 'sc');
    if (alive.length === 1) return { w: alive[0], reason: 'last-standing', rank: rank };
    return { w: rank[0], reason: st.t >= CONFIG.duration * 1000 ? 'time' : 'void', rank: rank };
  }

  var PF = ['x', 'y', 'al', 'sc', 'ln', 'd'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: st.seed, en: {}, p: {} };
      for (var oid in st.en) full.en[oid] = { g: st.en[oid].g };
      for (var k in st.p) {
        full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
        full.p[k].b = st.p[k].body.slice();
      }
      return full;
    }
    var d = { t: Math.round(st.t) };
    var ent = S.ed(st.en, last.en, ['g']);
    if (ent) d.en = ent;
    var pd = {};
    for (var key in st.p) {
      var cur = st.p[key], prev = last.p[key];
      var f = S.pd(cur, prev, PF);
      if (cur.al && (!prev || cur.body[0] !== prev.body[0])) {
        if (!f) f = {};
        f.hg = cur.body[0];
      }
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

  function bodyOf(view, pid) {
    var p = view.players[pid];
    var cache = view.s.bodies;
    var c = cache[pid];
    if (!c) c = cache[pid] = { cells: p.b ? p.b.slice() : [], head: p.b ? p.b[0] : -1 };
    if (p.b) { c.cells = p.b.slice(); c.head = p.b[0]; }
    else if (p.hg !== undefined && p.hg !== c.head) {
      c.cells.unshift(p.hg);
      c.head = p.hg;
    }
    while (c.cells.length > (p.ln || 0)) c.cells.pop();
    return c.cells;
  }

  function render(ctx, view, meId) {
    ctx.strokeStyle = 'rgba(0,255,242,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, COLS * CELL - 8, ROWS * CELL - 8);

    for (var oid in view.en) {
      var g = view.en[oid].g;
      var ox = px(g % COLS), oy = px((g / COLS) | 0);
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(view.now / 200 + g);
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ox, oy, 6, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) {
        var t0 = view.anim.deaths[pid];
        if (t0 === undefined) return;
        var prog = (view.now - t0) / 700;
        if (prog >= 1) return;
        var color0 = S.COLORS[(p.slot - 1) % 4];
        ctx.globalAlpha = 1 - prog;
        S.shape(ctx, p.x, p.y, p.sh, 9 * (1 - prog * 0.6), color0);
        ctx.globalAlpha = 1;
        return;
      }
      var color = S.COLORS[(p.slot - 1) % 4];
      var cells = bodyOf(view, pid);
      for (var i = cells.length - 1; i >= 0; i--) {
        var cg = cells[i];
        ctx.globalAlpha = 1 - (i / cells.length) * 0.55;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = i === 0 ? 6 : 0;
        var s = i === 0 ? CELL - 6 : CELL - 8;
        ctx.fillRect(px(cg % COLS) - s / 2, px((cg / COLS) | 0) - s / 2, s, s);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, p.y, color, view.now);
      S.shape(ctx, p.x, p.y, p.sh, 9, color);
      S.text(ctx, p.name + ' ' + (p.sc || 0), p.x, p.y - 18, { size: 10, glow: color, blur: 6 });
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
