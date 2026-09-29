/**
 * VOIDPLAY — client/engine.js
 * ---------------------------------------------------------------------------
 * HTML5 Canvas engine shared by every game:
 *   * 60 fps render loop (requestAnimationFrame)
 *   * snapshot INTERPOLATION — other players render 100 ms in the past,
 *     smoothly lerped between the server's 20 Hz state snapshots
 *   * CLIENT-SIDE PREDICTION — the local player is simulated instantly by
 *     the game module (predict/reconcile hooks); the server confirms or
 *     corrects
 *   * input handling → 6-bit key bitmask consumed by the 20 Hz input stream
 *   * particles, screen shake, neon HUD, chat toasts
 *
 * Games plug in via window.VP_GAMES[gameId] and implement:
 *   begin(config, myId), render(ctx, view, myPlayerId),
 *   predict(dt, keys), reconcile(serverMe, ackSeq), getPredPos(),
 *   getInstructions()
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const VP = global.VP || (global.VP = {});

  const CANVAS_W = 800;
  const CANVAS_H = 600;
  const INTERP_DELAY_MS = 100;      // render 100ms behind = smooth at 20Hz
  const MAX_SNAPS = 40;             // 2s of server history
  const FONT = '"system-ui", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  // Player colors by slot (shared visual language across all games)
  const PLAYER_COLORS = ['#00fff2', '#ff00e4', '#39ff14', '#ff6600'];
  VP.colors = PLAYER_COLORS;
  VP.CANVAS_W = CANVAS_W;
  VP.CANVAS_H = CANVAS_H;

  // ==========================================================================
  // Drawing helpers (shared by engine + game modules)
  // ==========================================================================

  VP.roundRect = function (ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  /** White text with a neon glow (the VOIDPLAY house style). */
  VP.text = function (ctx, str, x, y, o) {
    o = o || {};
    ctx.font = '700 ' + (o.size || 16) + 'px ' + FONT;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    ctx.shadowColor = o.glow || o.color || '#00fff2';
    ctx.shadowBlur = o.blur === undefined ? 10 : o.blur;
    ctx.fillStyle = o.color || '#ffffff';
    ctx.fillText(str, x, y);
    ctx.fillText(str, x, y); // double-pass = punchier glow
    ctx.shadowBlur = 0;
  };

  // ==========================================================================
  // Engine
  // ==========================================================================

  const engine = {
    running: false,
    game: null,          // client game module
    gameId: null,
    myId: 0,
    roomCode: '',
    config: null,
    roster: {},          // pid → { name, slot }
    merged: null,        // latest merged game state
    snaps: [],           // [{ at, pos: { pid: {x,y} } }] for interpolation
    anim: null,          // { deaths, crack, fall } local-timestamped events
    keys: 0,
    particles: [],
    shakeT: 0, shakeDur: 1, shakeMag: 0,
    chat: null,
    dead: false,
    canvas: null, ctx: null, raf: 0, lastFrame: 0,
  };
  VP.engine = engine;

  // -- lifecycle ----------------------------------------------------------------

  engine.start = function (opts) {
    // opts: { gameId, myId, roster, config, roomCode }
    this.gameId = opts.gameId;
    this.myId = opts.myId;
    this.config = opts.config || {};
    this.roomCode = opts.roomCode || '';
    this.roster = {};
    for (const r of opts.roster || []) this.roster[String(r.i)] = { name: r.n, slot: r.s };

    this.merged = null;
    this.snaps = [];
    this.anim = { deaths: {}, crack: {}, fall: {} };
    this.particles = [];
    this.keys = 0;
    this.chat = null;
    this.dead = false;
    this.shakeT = 0;

    this.game = (global.VP_GAMES || {})[this.gameId] || null;
    if (this.game && this.game.begin) this.game.begin(this.config, this.myId);

    const canvas = document.getElementById('game-canvas');
    this.canvas = canvas;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    this.ctx = canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    fitCanvas();
    this.running = true;
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.raf);
    const loop = (now) => {
      if (!engine.running) return;
      engine.frame(now);
      engine.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);

    VP.net.startInputs(() => engine.keys);
  };

  engine.stop = function () {
    this.running = false;
    cancelAnimationFrame(this.raf);
    VP.net.stopInputs();
    this.keys = 0;
  };

  // -- state ingest ---------------------------------------------------------------

  engine.onState = function (payload) {
    if (!payload || !payload.d) return;
    const d = payload.d;

    if (payload.f || !this.merged) {
      this.merged = { t: d.t || 0, ph: d.ph || 0, tiles: (d.tiles || []).slice(), p: {} };
      for (const pid in d.p || {}) this.merged.p[pid] = Object.assign({}, d.p[pid]);
    } else {
      const m = this.merged;
      if (d.t !== undefined) m.t = d.t;
      if (d.ph !== undefined) m.ph = d.ph;
      if (d.tl) {
        for (let i = 0; i < d.tl.length; i += 2) {
          const ti = d.tl[i], ph = d.tl[i + 1];
          if (m.tiles[ti] === ph) continue;
          const now = performance.now();
          if (ph === 1) this.anim.crack[ti] = now;
          else if (ph === 2) {
            this.anim.fall[ti] = now;
            const g = this.config && this.config.grid;
            if (g) {
              const gx = ti % g.cols, gy = (ti / g.cols) | 0;
              this.burst({
                x: g.offX + (gx + 0.5) * g.cellW, y: g.offY + (gy + 0.5) * g.cellH,
                color: '#00fff2', n: 6, speed: 60, life: 0.4, size: 2, grav: 160,
              });
            }
          }
          m.tiles[ti] = ph;
        }
      }
      if (d.p) {
        for (const pid in d.p) {
          const patch = d.p[pid];
          const tgt = m.p[pid] || (m.p[pid] = {});
          if (patch.al === 0 && tgt.al !== 0) {
            const now = performance.now();
            this.anim.deaths[pid] = now;
            const color = PLAYER_COLORS[((this.roster[pid] || {}).slot || 1) - 1] || '#00fff2';
            this.burst({ x: tgt.x || 0, y: tgt.y || 0, color, n: 26, speed: 200, life: 0.7, size: 3, grav: 120 });
            this.addShake(4, 220);
          }
          Object.assign(tgt, patch);
        }
      }
    }

    // snapshot for interpolating OTHER players
    const pos = {};
    for (const pid in this.merged.p) {
      const p = this.merged.p[pid];
      pos[pid] = { x: p.x, y: p.y };
    }
    this.snaps.push({ at: performance.now(), pos });
    if (this.snaps.length > MAX_SNAPS) this.snaps.shift();

    // reconciliation for ME
    const me = this.merged.p[String(this.myId)];
    if (me) {
      if (me.al === 0) this.dead = true;
      if (this.game && this.game.reconcile) this.game.reconcile(me, payload.a | 0);
    }
  };

  // -- per-frame ------------------------------------------------------------------

  engine.frame = function (now) {
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;

    if (this.game && this.game.predict && !this.dead) this.game.predict(dt, this.keys);

    const view = this.buildView(now);
    const ctx = this.ctx;

    ctx.save();
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt * 1000);
      const k = this.shakeT / this.shakeDur;
      ctx.translate((Math.random() * 2 - 1) * this.shakeMag * k, (Math.random() * 2 - 1) * this.shakeMag * k);
    }

    this.drawBackground(ctx);

    if (view && this.game && this.game.render) {
      this.game.render(ctx, view, this.myId, { now });
    } else if (view) {
      VP.text(ctx, 'NO RENDERER FOR THIS GAME', CANVAS_W / 2, CANVAS_H / 2, { size: 20, glow: '#ff00e4' });
    }

    this.drawParticles(ctx, dt);
    ctx.restore();

    if (view) this.drawHUD(ctx, view, now);
  };

  /** Latest state + interpolated positions (others) / predicted position (me). */
  engine.buildView = function (now) {
    const m = this.merged;
    if (!m) return null;

    const rt = now - INTERP_DELAY_MS;
    let s0 = null, s1 = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].at <= rt) { s0 = this.snaps[i]; s1 = this.snaps[i + 1] || s0; break; }
    }
    if (!s0) { s0 = this.snaps[0] || null; s1 = (s0 && this.snaps[1]) || s0; }
    let alpha = s0 && s1 && s1.at > s0.at ? (rt - s0.at) / (s1.at - s0.at) : 0;
    if (!isFinite(alpha)) alpha = 0;
    alpha = Math.max(0, Math.min(1, alpha));

    const players = {};
    for (const pid in m.p) {
      const p = m.p[pid];
      const meta = this.roster[pid] || { name: 'P' + pid, slot: Number(pid) || 1 };
      let x = p.x, y = p.y;
      const isMe = pid === String(this.myId);
      if (isMe && this.game && this.game.getPredPos && !this.dead) {
        const pp = this.game.getPredPos();
        if (pp) { x = pp.x; y = pp.y; }
      } else if (s0 && s0.pos[pid] && s1 && s1.pos[pid]) {
        x = s0.pos[pid].x + (s1.pos[pid].x - s0.pos[pid].x) * alpha;
        y = s0.pos[pid].y + (s1.pos[pid].y - s0.pos[pid].y) * alpha;
      }
      players[pid] = {
        x, y, gx: p.gx, gy: p.gy, d: p.d, m: p.m, al: p.al,
        name: meta.name, slot: meta.slot,
      };
    }
    return { t: m.t, ph: m.ph, tiles: m.tiles, players, anim: this.anim, now };
  };

  // -- background & HUD -------------------------------------------------------------

  engine.drawBackground = function (ctx) {
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(-8, -8, CANVAS_W + 16, CANVAS_H + 16);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 20; y < CANVAS_H; y += 40) {
      for (let x = 20; x < CANVAS_W; x += 40) {
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  };

  engine.drawHUD = function (ctx, view, now) {
    const dur = (this.config.duration || 90) * 1000;
    const remain = Math.max(0, dur - view.t);
    const secs = Math.ceil(remain / 1000);
    const mm = Math.floor(secs / 60);
    const ss = ('' + (secs % 60)).padStart(2, '0');

    // timer / sudden death (top-center)
    if (view.ph === 1) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 130);
      ctx.globalAlpha = 0.6 + 0.4 * pulse;
      VP.text(ctx, 'SUDDEN DEATH', CANVAS_W / 2, 26, { size: 22, glow: '#ff6600', color: '#ff6600' });
      ctx.globalAlpha = 1;
    } else {
      VP.text(ctx, mm + ':' + ss, CANVAS_W / 2, 26, { size: 22, glow: '#00fff2' });
    }

    // player chips: slots 1-2 top-left, 3-4 top-right
    const pids = Object.keys(view.players).sort();
    const left = pids.slice(0, 2), right = pids.slice(2);
    const drawChip = (pid, x, align) => {
      const p = view.players[pid];
      const color = PLAYER_COLORS[(p.slot - 1) % 4];
      ctx.globalAlpha = p.al ? 1 : 0.35;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
      VP.roundRect(ctx, x, 14, 12, 12, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '700 12px ' + FONT;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.name + (p.al ? '' : '  ✕'), align === 'left' ? x + 18 : x - 18, 21);
      ctx.globalAlpha = 1;
    };
    left.forEach((pid, i) => drawChip(pid, 14 + i * 150, 'left'));
    right.forEach((pid, i) => drawChip(pid, CANVAS_W - 14 - i * 150, 'right'));

    // room code (bottom-left)
    ctx.font = '700 12px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.shadowColor = '#00fff2';
    ctx.shadowBlur = 6;
    ctx.fillText('ROOM ' + this.roomCode, 14, CANVAS_H - 14);
    ctx.shadowBlur = 0;

    // ping (bottom-right)
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(VP.net.ping() + ' ms', CANVAS_W - 14, CANVAS_H - 14);

    // chat toast
    if (this.chat && now < this.chat.until) {
      ctx.globalAlpha = Math.min(1, (this.chat.until - now) / 600);
      ctx.font = '600 13px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillStyle = this.chat.color || '#fff';
      ctx.shadowColor = this.chat.color || '#00fff2';
      ctx.shadowBlur = 8;
      ctx.fillText(this.chat.text, 14, 60);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // spectator banner
    if (this.dead) {
      ctx.globalAlpha = 0.85;
      VP.text(ctx, 'YOU FELL — SPECTATING', CANVAS_W / 2, CANVAS_H - 40, { size: 15, glow: '#ff00e4', color: '#ff00e4' });
      ctx.globalAlpha = 1;
    }
  };

  // -- particles & shake ---------------------------------------------------------------

  engine.burst = function (o) {
    const n = o.n || 16;
    for (let i = 0; i < n; i++) {
      const a = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread || Math.PI * 2)
                                       : Math.random() * Math.PI * 2;
      const sp = (o.speed || 160) * (0.4 + Math.random() * 0.8);
      const life = (o.life || 0.6) * (0.6 + Math.random() * 0.7);
      this.particles.push({
        x: o.x, y: o.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life, max: life,
        color: o.color || '#00fff2',
        size: o.size || 3,
        grav: o.grav || 0,
      });
    }
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
  };

  engine.drawParticles = function (ctx, dt) {
    if (!this.particles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  };

  engine.addShake = function (mag, ms) {
    this.shakeMag = mag;
    this.shakeDur = ms;
    this.shakeT = ms;
  };

  engine.chatToast = function (name, text, color) {
    this.chat = { text: name + ': ' + text, color, until: performance.now() + 4000 };
  };

  // -- input ------------------------------------------------------------------------------

  const KEYMAP = {
    ArrowUp: 1, KeyW: 1,
    ArrowDown: 2, KeyS: 2,
    ArrowLeft: 4, KeyA: 4,
    ArrowRight: 8, KeyD: 8,
    Space: 16,
    ShiftLeft: 32, ShiftRight: 32,
  };

  function isEditable(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  function bindInput() {
    document.addEventListener('keydown', (e) => {
      if (!engine.running || isEditable(e.target) || e.repeat) return;
      const bit = KEYMAP[e.code];
      if (!bit) return;
      e.preventDefault();
      engine.keys |= bit;
    });
    document.addEventListener('keyup', (e) => {
      if (!engine.running) return;
      const bit = KEYMAP[e.code];
      if (!bit) return;
      e.preventDefault();
      engine.keys &= ~bit;
    });
    global.addEventListener('blur', () => { engine.keys = 0; });
  }
  bindInput();

  // -- canvas scaling ------------------------------------------------------------------------

  function fitCanvas() {
    const wrap = document.getElementById('game-wrap');
    const canvas = engine.canvas || document.getElementById('game-canvas');
    if (!wrap || !canvas) return;
    const s = Math.min(wrap.clientWidth / CANVAS_W, wrap.clientHeight / CANVAS_H) || 1;
    canvas.style.width = Math.floor(CANVAS_W * s) + 'px';
    canvas.style.height = Math.floor(CANVAS_H * s) + 'px';
  }
  global.addEventListener('resize', fitCanvas);
  document.addEventListener('DOMContentLoaded', fitCanvas);
})(window);
