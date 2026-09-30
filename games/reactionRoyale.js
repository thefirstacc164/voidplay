(function (root, factory) {
  var api = factory((root.VP && root.VP.S) || require('../shared/core.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP_GAMES = root.VP_GAMES || {}; root.VP_GAMES[api.CONFIG.id] = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  var W = 800, H = 600;
  var TYPES = ['click', 'wait', 'match', 'spam', 'freeze'];
  var TYPE_LABEL = { click: 'TAP FIRST', wait: "DON'T TAP", match: 'MATCH THE ARROW', spam: 'TAP FAST', freeze: 'FREEZE' };
  var DUR = [1500, 2700, 2100];
  var ROUNDS = 7, TARGET = 4;

  var CONFIG = {
    id: 'reactionRoyale', name: 'Reaction Royale', icon: '⚡',
    duration: 120, minPlayers: 2, maxPlayers: 4,
    description: 'Seven micro-rounds of pure reflex. Taps, patience, arrows, spam and freezes. First to four wins.',
    instructions: 'Space or W is your button, arrows answer matches. Rules change every round, read the screen.',
    world: { w: W, h: H }
  };

  function init(players) {
    var st = { t: 0, ph: 0, seed: 0, p: {} };
    st.rounds = [];
    var bag = TYPES.slice();
    for (var i = 0; i < ROUNDS; i++) {
      if (!bag.length) bag = TYPES.slice();
      st.rounds.push(bag.splice((Math.random() * bag.length) | 0, 1)[0]);
    }
    st.rn = 0;
    st.phase = 0;
    st.phT = 0;
    st.tg = 0;
    st.rw = -1;
    st.done = 0;
    var n = players.length;
    players.forEach(function (r, i) {
      st.p[String(r.i)] = {
        name: r.n, slot: r.s, sh: r.sh || 'sq', tr: r.tr || 't0', bot: r.bot ? 1 : 0,
        x: W / 2 + (i - (n - 1) / 2) * 150, y: 360,
        vx: 0, vy: 0, fx: 0, fy: -1,
        k: 0, lk: 0, tp: 0, pk: 0, al: 1, deathT: -1, sc: 0,
        wins: 0, out: 0, cnt: 0, flash: 0, mem: {}
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

  function roundTap(st, p, pid) {
    var ty = st.rounds[st.rn];
    if (ty === 'click') {
      if (st.phase === 1 && !p.out && st.rw < 0) st.rw = pid;
    } else if (ty === 'wait') {
      if (st.phase === 1 && !p.out) { p.out = 1; p.flash = 1; }
    } else if (ty === 'match') {
      if (st.phase === 1 && !p.out && st.rw < 0) {
        var dir = p.tp & 15;
        var want = 1 << st.tg;
        if (dir === want) st.rw = pid;
        else if (dir) { p.out = 1; p.flash = 1; }
      }
    } else if (ty === 'spam') {
      if (st.phase === 1 && !p.out) p.cnt++;
    }
  }

  function resolve(st) {
    var ty = st.rounds[st.rn];
    if (ty === 'click' || ty === 'match') {
      if (st.rw >= 0 && st.p[String(st.rw)]) {
        st.p[String(st.rw)].wins++;
        st.p[String(st.rw)].flash = 1;
      }
    } else if (ty === 'wait' || ty === 'freeze') {
      for (var k in st.p) if (!st.p[k].out) { st.p[k].wins++; st.p[k].flash = 1; }
    } else if (ty === 'spam') {
      var mx = 0;
      for (var k2 in st.p) if (!st.p[k2].out && st.p[k2].cnt > mx) mx = st.p[k2].cnt;
      if (mx > 0) for (var k3 in st.p) if (!st.p[k3].out && st.p[k3].cnt === mx) { st.p[k3].wins++; st.p[k3].flash = 1; }
    }
    for (var k4 in st.p) st.p[k4].sc = st.p[k4].wins * 10;
    for (var k5 in st.p) {
      if (st.p[k5].wins >= TARGET) { st.done = 1; st.winner = Number(k5); return; }
    }
  }

  function tick(st, dt) {
    st.t += dt;
    if (st.done) {
      for (var kd in st.p) S.endInput(st.p[kd]);
      return;
    }
    if (st.t - st.phT >= DUR[st.phase]) {
      st.phT = st.t;
      st.phase++;
      if (st.phase === 1) {
        st.rw = -1;
        for (var k in st.p) { st.p[k].out = 0; st.p[k].cnt = 0; st.p[k].flash = 0; }
        if (st.rounds[st.rn] === 'match') st.tg = (Math.random() * 4) | 0;
      } else if (st.phase === 2) {
        resolve(st);
      } else {
        st.rn++;
        st.phase = 0;
        if (st.rn >= ROUNDS) {
          st.done = 1;
          var best = -1, winner = -1;
          for (var k2 in st.p) {
            if (st.p[k2].wins > best) { best = st.p[k2].wins; winner = Number(k2); }
          }
          st.winner = winner;
          return;
        }
      }
    }
    for (var k3 in st.p) {
      var p = st.p[k3];
      if (!p.al) { S.endInput(p); continue; }
      if (st.phase === 1 && (p.tp & 16)) roundTap(st, p, Number(k3));
      if (st.phase === 1 && st.rounds[st.rn] === 'freeze' && (p.tp & 15)) { p.out = 1; p.flash = 1; }
      if (p.flash > 0) p.flash -= dt / 600;
      S.endInput(p);
    }
  }

  function checkWin(st) {
    if (!st.done) return null;
    var rank = S.rank(st, 'sc');
    return { w: st.winner, reason: 'rounds', rank: rank, sc: scores(st) };
  }

  function scores(st) {
    var o = {};
    for (var k in st.p) o[k] = st.p[k].sc;
    return o;
  }

  var PF = ['x', 'y', 'al', 'sc', 'wins', 'out', 'cnt'];

  function getState(st, last) {
    if (!last) {
      var full = { t: Math.round(st.t), ph: 0, seed: 0, p: {} };
      full.rounds = st.rounds;
      full.rn = st.rn; full.phase = st.phase; full.phT = Math.round(st.phT); full.tg = st.tg; full.rw = st.rw; full.done = st.done;
      for (var k in st.p) full.p[k] = S.pd(st.p[k], null, PF.concat(['name', 'slot', 'sh', 'tr']));
      return full;
    }
    var d = { t: Math.round(st.t) };
    if (st.rn !== last.rn) d.rn = st.rn;
    if (st.phase !== last.phase) d.phase = st.phase;
    if (st.tg !== last.tg) d.tg = st.tg;
    if (st.rw !== last.rw) d.rw = st.rw;
    if (st.done !== last.done) d.done = st.done;
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
      if (st.done) { p.aim = { x: 0, y: 0 }; continue; }
      if (p.mem.ph !== st.phase) {
        p.mem.ph = st.phase;
        p.mem.delay = 300 + Math.random() * 700;
        p.mem.err = Math.random() < 0.18;
        p.mem.next = 0;
      }
      if (st.phase !== 1) { p.aim = { x: Math.sin(st.t / 500 + p.slot) * 0.5, y: Math.cos(st.t / 620 + p.slot) * 0.4 }; continue; }
      var ty = st.rounds[st.rn];
      var el = st.t - st.phT;
      if (ty === 'click') {
        if (el > p.mem.delay && !p.out && st.rw < 0) p.tp |= 16;
      } else if (ty === 'wait') {
        if (p.mem.err && el > 500 + Math.random() * 1800) { if (Math.random() < 0.02) p.tp |= 16; }
      } else if (ty === 'match') {
        if (el > p.mem.delay && !p.out && st.rw < 0) {
          p.tp |= p.mem.err ? (1 << ((st.tg + 1 + ((Math.random() * 3) | 0)) % 4)) : (1 << st.tg);
        }
      } else if (ty === 'spam') {
        if (el > p.mem.next) { p.tp |= 16; p.mem.next = el + 130 + Math.random() * 90; }
      }
      p.aim = { x: 0, y: 0 };
    }
  }

  var ARROWS = ['▲', '▼', '◀', '▶'];

  function render(ctx, view, meId) {
    var rounds = view.rounds || TYPES;
    var rn = view.rn || 0;
    var phase = view.phase || 0;
    var ty = rounds[rn] || 'click';
    var phaseEl = view.t - (view.phT || 0);

    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, W, H);

    var bg = 'rgba(20,20,40,1)';
    if (phase === 1) {
      if (ty === 'click') bg = 'rgba(0,90,30,1)';
      else if (ty === 'wait') bg = 'rgba(110,0,10,1)';
      else if (ty === 'freeze') bg = 'rgba(0,40,90,1)';
      else bg = 'rgba(70,30,0,1)';
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < rounds.length; i++) {
      var done = i < rn;
      var cur = i === rn;
      ctx.fillStyle = done ? '#39ff14' : cur ? '#ffffff' : 'rgba(255,255,255,0.25)';
      S.rrect(ctx, W / 2 - (rounds.length * 26) / 2 + i * 26 + 4, 26, 18, 10, 4);
      ctx.fill();
    }

    if (phase === 0) {
      S.text(ctx, 'ROUND ' + (rn + 1), W / 2, 140, { size: 20, glow: '#ffffff' });
      S.text(ctx, TYPE_LABEL[ty], W / 2, 210, { size: 44, glow: '#00fff2', color: '#00fff2' });
      if (ty === 'click') S.text(ctx, 'tap the button the moment the screen turns green', W / 2, 270, { size: 13 });
      if (ty === 'wait') S.text(ctx, 'the screen will turn red. do NOT tap.', W / 2, 270, { size: 13 });
      if (ty === 'match') S.text(ctx, 'press the arrow shown the instant it appears', W / 2, 270, { size: 13 });
      if (ty === 'spam') S.text(ctx, 'mash the button as fast as you can', W / 2, 270, { size: 13 });
      if (ty === 'freeze') S.text(ctx, 'do not touch any movement key until the round ends', W / 2, 270, { size: 13 });
    } else if (phase === 1) {
      if (ty === 'click' || ty === 'spam') {
        var beat = ty === 'click' ? 1 : 0.75 + 0.25 * Math.sin(view.now / 60);
        ctx.fillStyle = 'rgba(57,255,20,' + (0.16 * beat).toFixed(2) + ')';
        ctx.fillRect(0, 0, W, H);
        S.text(ctx, ty === 'click' ? 'TAP!' : 'TAP TAP TAP', W / 2, 200, { size: 56, glow: '#39ff14', color: '#39ff14' });
      } else if (ty === 'wait') {
        S.text(ctx, 'WAIT...', W / 2, 200, { size: 56, glow: '#ff0044', color: '#ff0044' });
      } else if (ty === 'match') {
        S.text(ctx, ARROWS[view.tg || 0], W / 2, 215, { size: 90, glow: '#00fff2', color: '#00fff2' });
      } else {
        S.text(ctx, '❄ FREEZE ❄', W / 2, 200, { size: 56, glow: '#4488ff', color: '#4488ff' });
      }
    } else {
      var rwP = view.rw >= 0 ? view.players[String(view.rw)] : null;
      var msg = rwP ? rwP.name + ' WINS THE ROUND' : 'ROUND OVER';
      S.text(ctx, msg, W / 2, 200, { size: 34, glow: '#39ff14', color: '#39ff14' });
      if (rwP) {
        S.text(ctx, (rwP.wins || 0) + ' / ' + TARGET + ' wins', W / 2, 250, { size: 16, glow: '#ffffff' });
      }
    }

    var pids = Object.keys(view.players);
    pids.forEach(function (pid) {
      var p = view.players[pid];
      if (!p.al) return;
      var color = S.COLORS[(p.slot - 1) % 4];
      var y = p.y + Math.sin(view.now / 500 + p.slot * 2) * 6;
      ctx.save();
      if (p.flash > 0) {
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 24;
      }
      if (p.out) ctx.globalAlpha = 0.35;
      if (String(pid) === String(meId)) S.meRing(ctx, p.x, y, color, view.now);
      S.shape(ctx, p.x, y, p.sh, 20, color);
      ctx.restore();
      S.text(ctx, p.name, p.x, y - 38, { size: 11, glow: color, blur: 6 });
      S.text(ctx, '★'.repeat(p.wins || 0) || '·', p.x, y + 44, { size: 14, glow: '#39ff14', color: '#39ff14' });
      if (phase === 1 && rounds[rn] === 'spam' && !p.out) {
        S.text(ctx, String(p.cnt || 0), p.x, y + 66, { size: 16, glow: '#ffffff' });
      }
    });
  }

  return { CONFIG: CONFIG, init: init, onInput: onInput, onPlayerLeft: onPlayerLeft, tick: tick, checkWin: checkWin, getState: getState, bots: bots, render: render };
});
