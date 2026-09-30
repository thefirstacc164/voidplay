(function (root) {
  'use strict';

  var VP = root.VP;
  var S = VP.S;
  var W = 800, H = 600;
  var STEP = 1000 / 60;
  var BOT_NAMES = ['Nova', 'Pixel', 'Echo', 'Byte', 'Zap', 'Fuse', 'Mint', 'Juno', 'Rex', 'Vex', 'Kilo', 'Onyx', 'Pip', 'Quill', 'Rune', 'Sage', 'Tesla', 'Umbra', 'Volt', 'Wren'];

  var canvas = null;
  var ctx = null;

  var E = {
    mode: null,
    game: null,
    gameId: null,
    st: null,
    meId: null,
    twoP: false,
    running: false,
    ended: false,
    config: null,
    onEnd: null,
    keys1: 0,
    keys2: 0,
    remote: null,
    onChat: null,
    countdown: 0,
    cdStage: 0,
  };

  function snd(name) {
    if (root.VP && root.VP.sound && root.VP.sound[name]) root.VP.sound[name]();
  }

  var scratch = {};
  var anim = { deaths: {}, tiles: {} };
  var prevAlive = {};
  var prevTiles = null;
  var fxList = [];
  var shakeMag = 0;
  var lastFrame = 0;
  var acc = 0;
  var raf = 0;
  var chatFade = [];

  function fxSink(type, data) {
    if (!E.running) return;
    if (type === 'burst') {
      var n = Math.min(40, data.n || 10);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var sp = (data.speed || 200) * (0.3 + Math.random() * 0.7);
        fxList.push({
          x: data.x, y: data.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 450 + Math.random() * 350, age: 0,
          color: data.color || '#ffffff',
          r: 1.5 + Math.random() * 2.5,
        });
      }
    } else if (type === 'death') {
      fxList.push({ ring: 1, x: data.x, y: data.y, life: 480, age: 0, color: '#ff0055' });
      for (var j = 0; j < 14; j++) {
        var a2 = Math.random() * Math.PI * 2;
        var sp2 = 90 + Math.random() * 160;
        fxList.push({ x: data.x, y: data.y, vx: Math.cos(a2) * sp2, vy: Math.sin(a2) * sp2, life: 400 + Math.random() * 300, age: 0, color: '#ff0055', r: 1.5 + Math.random() * 2 });
      }
    } else if (type === 'shake') {
      shakeMag = Math.max(shakeMag, data.mag || 3);
    }
  }

  S.fx.set(fxSink);

  var loading = {};

  function loadGame(id, cb) {
    if (root.VP_GAMES && root.VP_GAMES[id]) return cb(null, root.VP_GAMES[id]);
    if (loading[id]) {
      loading[id].push(cb);
      return;
    }
    loading[id] = [cb];
    var s = document.createElement('script');
    s.src = '/games/' + id + '.js?v=' + (VP.ASSET_V || 0);
    s.onload = function () {
      var list = loading[id];
      loading[id] = null;
      var mod = root.VP_GAMES && root.VP_GAMES[id];
      for (var i = 0; i < list.length; i++) list[i](mod ? null : new Error('no module'), mod);
    };
    s.onerror = function () {
      var list = loading[id];
      loading[id] = null;
      for (var i = 0; i < list.length; i++) list[i](new Error('load failed'), null);
    };
    document.head.appendChild(s);
  }

  function isLoaded(id) {
    return !!(root.VP_GAMES && root.VP_GAMES[id]);
  }

  function botRoster(count, startSlot) {
    var out = [];
    var pool = BOT_NAMES.slice();
    for (var i = 0; i < count; i++) {
      var idx = (Math.random() * pool.length) | 0;
      var name = pool.splice(idx, 1)[0] || ('BOT ' + (startSlot + i));
      var shapes = VP.ITEMS.SHAPES;
      out.push({
        i: startSlot + i,
        n: 'BOT ' + name,
        s: startSlot + i,
        sh: shapes[(Math.random() * shapes.length) | 0].id,
        tr: 't0',
        bot: true,
      });
    }
    return out;
  }

  function startLocal(gameId, mode, botCount, me, onEnd) {
    loadGame(gameId, function (err, game) {
      if (err || !game) return;
      var roster = [{ i: 1, n: me.name, s: 1, sh: me.shape || 'sq', tr: me.trail || 't0' }];
      if (mode === '2p') roster.push({ i: 2, n: 'Player 2', s: 2, sh: me.shape || 'sq', tr: 't0' });
      roster = roster.concat(botRoster(botCount, roster.length + 1));
      stop();
      E.mode = 'local';
      E.game = game;
      E.gameId = gameId;
      E.config = game.CONFIG;
      E.st = game.init(roster);
      E.meId = 1;
      E.twoP = mode === '2p';
      E.running = true;
      E.ended = false;
      E.onEnd = onEnd || null;
      E.countdown = 2400;
      E.cdStage = 4;
      resetViewCaches();
      lastFrame = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    });
  }

  function startRemote(gameId, config, mePid) {
    stop();
    E.mode = 'remote';
    E.gameId = gameId;
    E.config = config;
    E.meId = mePid;
    E.twoP = false;
    E.running = true;
    E.ended = false;
    E.remote = { view: null, lastT: 0, lastMsgAt: 0, pending: [] };
    resetViewCaches();
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
    loadGame(gameId, function (err, game) {
      if (err || !game) {
        E.running = false;
        return;
      }
      E.game = game;
      if (!E.config) E.config = game.CONFIG;
      var r = E.remote;
      if (r && r.pending) {
        var queued = r.pending;
        r.pending = null;
        for (var i = 0; i < queued.length; i++) applyState(queued[i]);
      }
    });
  }

  function resetViewCaches() {
    scratch = {};
    anim = { deaths: {}, tiles: {} };
    prevAlive = {};
    prevTiles = null;
    fxList = [];
    shakeMag = 0;
    chatFade = [];
  }

  function stop() {
    E.running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    E.mode = null;
    E.st = null;
    E.remote = null;
    E.game = null;
    E.config = null;
    E.ended = false;
  }

  function stepLocal(ms) {
    var game = E.game;
    game.onInput(E.st, 1, { k: E.keys1 });
    if (E.twoP) game.onInput(E.st, 2, { k: E.keys2 });
    game.bots(E.st);
    game.tick(E.st, ms);
    if (!E.ended) {
      var win = game.checkWin(E.st);
      if (win) {
        E.ended = true;
        if (E.onEnd) E.onEnd(win, true);
      }
    }
  }

  var localView = {};

  function buildLocalView() {
    var st = E.st;
    localView.t = st.t;
    localView.ph = st.ph || 0;
    localView.seed = st.seed;
    localView.players = st.p;
    localView.en = st.en || {};
    localView.tiles = st.tiles || [];
    localView.s = scratch;
    localView.anim = anim;
    localView.w = W;
    localView.h = H;
    if (st.ly !== undefined) localView.ly = st.ly;
    if (st.puck) localView.pk = st.puck;
    if (st.sc) localView.sc = st.sc;
    if (st.freeze !== undefined) localView.fz = st.freeze;
    if (st.rounds) {
      localView.rounds = st.rounds;
      localView.rn = st.rn;
      localView.phase = st.phase;
      localView.phT = st.phT;
      localView.tg = st.tg;
      localView.rw = st.rw;
      localView.done = st.done;
    }
    watchDeaths(st.p);
    watchTiles(localView.tiles);
    return localView;
  }

  function copyExtras(v, d) {
    var keys = ['ly', 'sc', 'fz', 'rounds', 'rn', 'phase', 'phT', 'tg', 'rw', 'done'];
    for (var i = 0; i < keys.length; i++) {
      if (d[keys[i]] !== undefined) v[keys[i]] = d[keys[i]];
    }
    if (d.pk !== undefined) v.pk = { x: d.pk[0], y: d.pk[1] };
  }

  function applyState(msg) {
    var r = E.remote;
    if (!r || !E.running) return;
    var d = msg.d;
    if (!d) return;
    if (!E.game) {
      if (r.pending && r.pending.length < 8) r.pending.push(msg);
      return;
    }
    if (msg.f) {
      var v = {
        t: d.t, ph: d.ph || 0, seed: d.seed,
        players: d.p || {}, en: d.en || {}, tiles: d.tiles || [],
        s: scratch, anim: anim, w: W, h: H,
      };
      copyExtras(v, d);
      r.view = v;
      r.lastT = d.t;
      r.lastMsgAt = performance.now();
      for (var k in v.players) {
        var p = v.players[k];
        p.tx = p.x;
        p.ty = p.y;
      }
      watchDeaths(v.players);
      watchTiles(v.tiles);
      return;
    }
    var view = r.view;
    if (!view) return;
    if (d.t !== undefined) {
      r.lastT = d.t;
      r.lastMsgAt = performance.now();
    }
    if (d.p) {
      for (var pid in d.p) {
        var pd = d.p[pid];
        if (!view.players[pid]) {
          view.players[pid] = pd;
          var np = view.players[pid];
          np.tx = np.x;
          np.ty = np.y;
        } else {
          var tp = view.players[pid];
          for (var f in pd) tp[f] = pd[f];
          if (pd.x !== undefined) tp.tx = pd.x;
          if (pd.y !== undefined) tp.ty = pd.y;
        }
      }
      watchDeaths(view.players);
    }
    if (d.en) {
      if (d.en.eu) {
        for (var eid in d.en.eu) {
          var fields = d.en.eu[eid];
          if (!view.en[eid]) view.en[eid] = {};
          var ent = view.en[eid];
          for (var ef in fields) ent[ef] = fields[ef];
        }
      }
      if (d.en.er) {
        for (var i = 0; i < d.en.er.length; i++) delete view.en[d.en.er[i]];
      }
    }
    if (d.tiles) {
      for (var ti = 0; ti < d.tiles.length; ti += 2) {
        view.tiles[d.tiles[ti]] = d.tiles[ti + 1];
      }
      watchTiles(view.tiles);
    }
    copyExtras(view, d);
  }

  function watchDeaths(players) {
    for (var k in players) {
      var p = players[k];
      if (prevAlive[k] && !p.al) {
        anim.deaths[k] = performance.now();
        snd('death');
      }
      prevAlive[k] = p.al;
    }
  }

  function watchTiles(tiles) {
    if (!tiles || !tiles.length) { prevTiles = null; return; }
    if (!prevTiles) {
      prevTiles = tiles.slice();
      return;
    }
    for (var i = 0; i < tiles.length; i++) {
      if (prevTiles[i] !== tiles[i]) anim.tiles[i] = { ph: tiles[i], t: performance.now() };
    }
    prevTiles = tiles.slice();
  }

  function stepRemote(dtMs) {
    var r = E.remote;
    if (!r || !r.view) return;
    r.view.t = r.lastT + (performance.now() - r.lastMsgAt);
    var d = dtMs / 1000;
    for (var k in r.view.players) {
      var p = r.view.players[k];
      if (typeof p.tx !== 'number') continue;
      var dx = p.tx - p.x;
      var dy = p.ty - p.y;
      if (Math.hypot(dx, dy) > 90) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        p.x += dx * 0.15 + (p.vx || 0) * d;
        p.y += dy * 0.15 + (p.vy || 0) * d;
      }
    }
  }

  function frame(now) {
    if (!E.running) return;
    raf = requestAnimationFrame(frame);
    var dt = now - lastFrame;
    lastFrame = now;
    if (dt > 200) dt = 200;
    if (E.mode === 'local') {
      if (E.countdown > 0) {
        E.countdown -= dt;
        var stage = Math.ceil(E.countdown / 800);
        if (stage !== E.cdStage && stage >= 1) {
          E.cdStage = stage;
          snd('count');
        }
        if (E.countdown <= 0) snd('go');
      } else {
        acc += dt;
        var guard = 0;
        while (acc >= STEP && guard < 6) {
          stepLocal(STEP);
          acc -= STEP;
          guard++;
        }
        if (guard >= 6) acc = 0;
      }
    } else {
      stepRemote(dt);
    }
    renderFrame(now);
  }

  function renderFrame(now) {
    var game = E.game;
    if (!game) return;
    var view = E.mode === 'local' ? buildLocalView() : (E.remote && E.remote.view);
    if (!view) return;
    view.now = now;
    ctx.save();
    if (shakeMag > 0.2) {
      ctx.translate((Math.random() - 0.5) * shakeMag * 2, (Math.random() - 0.5) * shakeMag * 2);
      shakeMag *= 0.88;
    } else {
      shakeMag = 0;
    }
    ctx.fillStyle = '#07070f';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    try {
      game.render(ctx, view, E.meId);
    } catch (err) {
      ctx.restore();
      return;
    }
    drawTrails(view, now);
    drawFx(dt2(now));
    ctx.restore();
    drawHud(view, now);
  }

  function drawTrails(view, now) {
    if (!scratch.trails) scratch.trails = {};
    var hist = scratch.trails;
    var pids = Object.keys(view.players || {});
    for (var i = 0; i < pids.length; i++) {
      var p = view.players[pids[i]];
      if (!p || !p.al || !p.tr || p.tr === 't0') continue;
      var h = hist[pids[i]] || (hist[pids[i]] = []);
      var last = h[h.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 3) {
        h.push({ x: p.x, y: p.y, t: now });
        if (h.length > 26) h.shift();
      }
      var color = S.COLORS[((p.slot || p.s || 1) - 1) % 4];
      if (p.tr === 't1') {
        for (var j = 0; j < h.length; j++) {
          var a = 1 - (now - h[j].t) / 500;
          if (a <= 0) continue;
          ctx.fillStyle = color;
          ctx.globalAlpha = a * 0.5;
          var sz = 1 + a * 2.5;
          ctx.fillRect(h[j].x - sz / 2 + (j % 2 ? 2 : -2), h[j].y - sz / 2, sz, sz);
        }
      } else if (p.tr === 't2') {
        if (h.length > 1) {
          ctx.strokeStyle = color;
          ctx.lineCap = 'round';
          for (var k = 1; k < h.length; k++) {
            var a2 = 1 - (now - h[k].t) / 600;
            if (a2 <= 0) continue;
            ctx.globalAlpha = a2 * 0.45;
            ctx.lineWidth = 7 * a2;
            ctx.beginPath();
            ctx.moveTo(h[k - 1].x, h[k - 1].y);
            ctx.lineTo(h[k].x, h[k].y);
            ctx.stroke();
          }
        }
      } else if (p.tr === 't4') {
        for (var m = 0; m < h.length; m += 2) {
          var age = (now - h[m].t) / 700;
          if (age >= 1) continue;
          ctx.globalAlpha = (1 - age) * 0.35;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(h[m].x, h[m].y - age * 14, 2 + age * 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (p.tr === 't3') {
        for (var q = 0; q < h.length; q++) {
          var a3 = 1 - (now - h[q].t) / 550;
          if (a3 <= 0) continue;
          var hue = ((now / 12) + q * 14) % 360;
          ctx.globalAlpha = a3 * 0.6;
          ctx.fillStyle = 'hsl(' + hue + ',100%,60%)';
          var sz2 = 2 + a3 * 3;
          ctx.fillRect(h[q].x - sz2 / 2, h[q].y - sz2 / 2, sz2, sz2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  var lastFxT = 0;
  function dt2(now) {
    var d = now - lastFxT;
    lastFxT = now;
    return Math.min(100, d) / 1000;
  }

  function drawFx(d) {
    for (var i = fxList.length - 1; i >= 0; i--) {
      var f = fxList[i];
      f.age += d * 1000;
      if (f.age >= f.life) { fxList.splice(i, 1); continue; }
      var k = 1 - f.age / f.life;
      if (f.ring) {
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = k * 0.8;
        ctx.lineWidth = 2 + k * 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, (1 - k) * 46 + 6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        f.x += f.vx * d;
        f.y += f.vy * d;
        f.vy += 140 * d;
        ctx.fillStyle = f.color;
        ctx.globalAlpha = k;
        ctx.fillRect(f.x - f.r / 2, f.y - f.r / 2, f.r, f.r);
      }
    }
    ctx.globalAlpha = 1;
  }

  function fmtTime(ms) {
    if (ms < 0) ms = 0;
    var s = Math.ceil(ms / 1000);
    var mm = (s / 60) | 0;
    var ss = s % 60;
    return mm + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function drawHud(view, now) {
    if (!E.config) return;
    var left = E.config.duration * 1000 - view.t;
    if (E.config.duration) {
      var urgent = left < 10000;
      S.text(ctx, fmtTime(left), W / 2, 26, { size: 22, glow: urgent ? '#ff4400' : '#00fff2', color: urgent ? '#ff4400' : null });
    }
    var pids = Object.keys(view.players);
    pids.sort(function (a, b) { return (view.players[a].s || 0) - (view.players[b].s || 0); });
    var x = 14;
    for (var i = 0; i < pids.length; i++) {
      var p = view.players[pids[i]];
      var color = S.COLORS[((p.slot || p.s || 1) - 1) % 4];
      var label = (p.name || '') + (p.sc !== undefined ? ' ' + p.sc : '');
      ctx.fillStyle = 'rgba(7,7,15,0.6)';
      var w = ctx.measureText(label).width;
      S.rrect(ctx, x - 4, 10, 12, 12, 3);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(x, 12, 10, 10);
      S.text(ctx, label, x + 16, 21, { size: 11, glow: color, blur: 4 });
      x += 16 + Math.max(60, label.length * 7);
    }
    var me = view.players[String(E.meId)];
    if (me && !me.al) {
      S.text(ctx, 'YOU DIED - SPECTATING', W / 2, H - 26, { size: 15, glow: '#ff00e4', color: '#ff00e4' });
    }
    if (E.mode === 'remote') {
      S.text(ctx, VP.net.ping() + ' ms', W - 14, H - 14, { size: 10, align: 'right', glow: '#ffffff', blur: 0 });
    }
    if (E.mode === 'local' && E.twoP) {
      S.text(ctx, 'P1 WASD + SPACE      P2 ARROWS + ENTER', W / 2, H - 14, { size: 11, glow: '#ffffff', blur: 0 });
    }
    if (E.mode === 'local' && E.countdown > 0) {
      var n = Math.ceil(E.countdown / 800);
      if (n >= 1) {
        ctx.fillStyle = 'rgba(4,4,10,0.45)';
        ctx.fillRect(0, 0, W, H);
        S.text(ctx, String(n), W / 2, H / 2, { size: 120, glow: '#00fff2', color: '#ffffff' });
        S.text(ctx, 'GET READY', W / 2, H / 2 + 90, { size: 16, glow: '#ff0099', color: '#ff0099' });
      }
    }
    if ((E.mode === 'local' && E.countdown <= 0 && view.t < 700) ||
        (E.mode === 'remote' && view.t < 700)) {
      var a = 1 - view.t / 700;
      ctx.globalAlpha = a;
      S.text(ctx, 'GO!', W / 2, H / 2, { size: 90, glow: '#39ff14', color: '#39ff14' });
      ctx.globalAlpha = 1;
    }
    var cut = now - 9000;
    var lines = 0;
    for (var c = chatFade.length - 1; c >= 0; c--) {
      var m = chatFade[c];
      if (m.t < cut) { chatFade.splice(c, 1); continue; }
      lines++;
      var a = Math.min(1, (m.t + 9000 - now) / 2500);
      ctx.globalAlpha = a;
      S.text(ctx, m.text, 14, H - 60 - lines * 18, { size: 12, glow: '#ffffff', blur: 0 });
      ctx.globalAlpha = 1;
      if (lines >= 5) break;
    }
  }

  function pushChat(text) {
    chatFade.push({ t: performance.now(), text: String(text).slice(0, 120) });
    if (chatFade.length > 12) chatFade.shift();
  }

  var KEYMAP1 = {
    KeyW: 1, KeyS: 2, KeyA: 4, KeyD: 8,
    Space: 16, ShiftLeft: 32,
  };
  var KEYMAP2 = {
    ArrowUp: 1, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 8,
    Enter: 16, ShiftRight: 32,
  };

  function editable(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  var keysBound = false;

  function bindKeys() {
    if (keysBound) return;
    keysBound = true;
    document.addEventListener('keydown', function (ev) {
      if (editable(ev.target)) return;
      if (ev.repeat) return;
      var b1 = KEYMAP1[ev.code];
      var b2 = KEYMAP2[ev.code];
      if (b1) {
        if (E.running && !E.countdown) {
          if (b1 === 16) snd('jump');
          else if (b1 === 32) snd('dash');
        }
        E.keys1 |= b1;
        ev.preventDefault();
      }
      if (b2) {
        if (E.running && !E.countdown) {
          if (b2 === 16) snd('jump');
          else if (b2 === 32) snd('dash');
        }
        E.keys2 |= b2;
        ev.preventDefault();
      }
    });
    document.addEventListener('keyup', function (ev) {
      var b1 = KEYMAP1[ev.code];
      var b2 = KEYMAP2[ev.code];
      if (b1) E.keys1 &= ~b1;
      if (b2) E.keys2 &= ~b2;
    });
    window.addEventListener('blur', function () {
      E.keys1 = 0;
      E.keys2 = 0;
    });
  }

  function netKeys() {
    return E.keys1 | E.keys2;
  }

  function attach(canvasEl) {
    canvas = canvasEl;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    bindKeys();
  }

  function fitCanvas() {
    if (!canvas) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var scale = Math.min(vw / W, vh / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
  }

  VP.engine = {
    E: E,
    attach: attach,
    fitCanvas: fitCanvas,
    loadGame: loadGame,
    isLoaded: isLoaded,
    startLocal: startLocal,
    startRemote: startRemote,
    applyState: applyState,
    stop: stop,
    netKeys: netKeys,
    pushChat: pushChat,
  };
})(typeof self !== 'undefined' ? self : globalThis);
