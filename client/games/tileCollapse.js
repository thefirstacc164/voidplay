/**
 * VOIDPLAY — client/games/tileCollapse.js
 * ---------------------------------------------------------------------------
 * Client side of Tile Collapse: renderer + client-side prediction.
 *
 * PREDICTION
 *   The local player's hops are simulated immediately (same rules as the
 *   server: 150ms hops, blocked by fallen tiles/out of bounds). When a
 *   server snapshot arrives we reconcile:
 *     * server state matches prediction        → keep prediction (no lag)
 *     * server is behind a recent prediction   → wait, it will catch up
 *     * server rejected/difers from prediction → snap to server truth
 *   All movement constants come from the server's CONFIG.grid, so both
 *   simulations are guaranteed to use identical numbers.
 *
 * RENDERING
 *   Intact tiles → flat neon platforms. Cracked → jitter + crack lines.
 *   Falling → drop/shrink/fade animation. Players → glowing rounded squares
 *   with a facing "eye", name labels, and a spin-and-fade death animation.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const VP = global.VP;
  const G = {};
  global.VP_GAMES = global.VP_GAMES || {};
  global.VP_GAMES.tileCollapse = G;

  // Server-provided grid constants (set in begin()).
  let CFG = null;
  // Predicted local player state (null until the first snapshot).
  let P = null;
  // History of predicted grid states for "server is catching up" checks.
  let history = [];

  const DX = [0, 0, -1, 1];
  const DY = [-1, 1, 0, 0];

  function idx(gx, gy) { return gy * CFG.cols + gx; }
  function cx(gx) { return CFG.offX + (gx + 0.5) * CFG.cellW; }
  function cy(gy) { return CFG.offY + (gy + 0.5) * CFG.cellH; }

  /** Same priority order as the server — keep in sync. */
  function dirFromKeys(k) {
    if (k & 1) return 0;
    if (k & 2) return 1;
    if (k & 4) return 2;
    if (k & 8) return 3;
    return -1;
  }

  function pushHistory() {
    history.push({ t: performance.now(), gx: P.gx, gy: P.gy, m: P.m, d: P.d });
    if (history.length > 60) history.shift();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  G.begin = function (config) {
    CFG = config && config.grid ? config.grid : null;
    P = null;
    history = [];
  };

  G.getInstructions = function () {
    return 'WASD / Arrows to hop · tiles crack after you leave them, then fall · don\'t be standing on one when it drops · last one standing wins';
  };

  // ==========================================================================
  // Client-side prediction
  // ==========================================================================

  G.predict = function (dt, keys) {
    if (!CFG || !P || P.dead) return;
    const tiles = VP.engine.merged ? VP.engine.merged.tiles : null;

    if (P.m) {
      P.elapsed += dt * 1000;
      if (P.elapsed >= CFG.moveMs) {
        P.gx = P.fromGx + DX[P.d];
        P.gy = P.fromGy + DY[P.d];
        P.m = 0;
        P.elapsed = 0;
        pushHistory();
      }
    }
    if (!P.m) {
      const dir = dirFromKeys(keys);
      if (dir >= 0) {
        P.d = dir;
        const nx = P.gx + DX[dir];
        const ny = P.gy + DY[dir];
        const blocked = nx < 0 || ny < 0 || nx >= CFG.cols || ny >= CFG.rows
          || (tiles && tiles[idx(nx, ny)] === 2);
        if (!blocked) {
          P.m = 1;
          P.elapsed = 0;
          P.fromGx = P.gx;
          P.fromGy = P.gy;
          P.startSeq = VP.net.peekSeq(); // the input packet that carries this move
          pushHistory();
        }
      }
    }
  };

  G.getPredPos = function () {
    if (!CFG || !P) return null;
    if (P.m) {
      const t = Math.min(1, P.elapsed / CFG.moveMs);
      const fx = cx(P.fromGx), fy = cy(P.fromGy);
      const tx = cx(P.fromGx + DX[P.d]), ty = cy(P.fromGy + DY[P.d]);
      return { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t };
    }
    return { x: cx(P.gx), y: cy(P.gy) };
  };

  /** serverMe = authoritative state of the local player at ack `ack`. */
  G.reconcile = function (s, ack) {
    if (!CFG) return;
    if (s.al === 0) { if (P) P.dead = true; return; }
    if (!P) { P = fromServer(s, ack); pushHistory(); return; }

    // in sync → just keep the server's move progress
    if (samePos(P, s)) {
      if (P.m && s.m === 1) syncProgress(s);
      return;
    }

    // our current move hasn't even reached the server yet
    if (P.m && P.startSeq > ack) return;

    // the server may simply be behind one of our recent predicted states
    const now = performance.now();
    const window = (VP.net.ping() || 40) + 350;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (now - h.t > window) break;
      if (samePos(h, s)) return; // server catching up — hold the prediction
    }

    // genuine divergence (rejected hop / correction) → snap to the server
    P = fromServer(s, ack);
    history = [];
    pushHistory();
  };

  function samePos(a, s) {
    if (a.gx !== s.gx || a.gy !== s.gy) return false;
    if (a.m === s.m) return a.m === 0 || a.d === s.d;
    // a hop we predicted as "started" may not have started on the server yet
    return a.m === 1 && s.m === 0;
  }

  function fromServer(s, ack) {
    const p = {
      gx: s.gx, gy: s.gy, m: s.m, d: s.d, elapsed: 0,
      fromGx: s.gx, fromGy: s.gy, startSeq: ack | 0, dead: false,
    };
    if (s.m === 1) syncProgressInto(p, s);
    return p;
  }

  function syncProgress(s) { if (s && s.m === 1) syncProgressInto(P, s); }

  function syncProgressInto(p, s) {
    const fx = cx(s.gx), fy = cy(s.gy);
    const tx = cx(s.gx + DX[s.d]), ty = cy(s.gy + DY[s.d]);
    let prog = 0;
    if (tx !== fx) prog = (s.x - fx) / (tx - fx);
    else if (ty !== fy) prog = (s.y - fy) / (ty - fy);
    prog = Math.max(0, Math.min(1, prog));
    p.fromGx = s.gx;
    p.fromGy = s.gy;
    p.d = s.d;
    p.elapsed = prog * CFG.moveMs;
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  // deterministic per-tile "randomness" for crack patterns
  function tileRand(i, salt) {
    const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  G.render = function (ctx, view, meId) {
    if (!CFG) return;
    const now = view.now;

    // ---- tiles ----
    for (let i = 0; i < view.tiles.length; i++) {
      const ph = view.tiles[i];
      if (ph === 2) {
        const t0 = view.anim.fall[i];
        if (t0 !== undefined) {
          const prog = (now - t0) / 320;
          if (prog < 1) drawFallingTile(ctx, i, prog, now);
        }
        continue; // fallen long ago → void
      }
      drawTile(ctx, i, ph, now, view.anim);
    }

    // ---- players: dead first (behind), then alive ----
    const pids = Object.keys(view.players);
    for (const pid of pids) if (view.players[pid].al === 0) drawDeadPlayer(ctx, view, pid, now);
    for (const pid of pids) if (view.players[pid].al === 1) drawPlayer(ctx, view, pid, pid === String(meId), now);
  };

  function tileRect(i) {
    const gx = i % CFG.cols;
    const gy = (i / CFG.cols) | 0;
    return {
      x: CFG.offX + gx * CFG.cellW + 4,
      y: CFG.offY + gy * CFG.cellH + 4,
      w: CFG.cellW - 8,
      h: CFG.cellH - 8,
    };
  }

  function drawTile(ctx, i, ph, now, anim) {
    const r = tileRect(i);
    const cracked = ph === 1;
    const t0 = cracked ? anim.crack[i] : undefined;
    const pop = t0 !== undefined ? Math.max(0, 1 - (now - t0) / 180) : 0; // crack flash

    ctx.save();
    if (cracked) {
      const j = Math.sin(now / 45 + i * 1.7) * 1.1;
      ctx.translate(j, Math.cos(now / 38 + i) * 1.1);
    }

    ctx.fillStyle = cracked ? 'rgba(255,102,0,0.05)' : 'rgba(0,255,242,0.05)';
    VP.roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pop > 0
      ? 'rgba(255,255,255,' + (0.4 + 0.6 * pop) + ')'
      : cracked ? 'rgba(255,140,60,0.4)' : 'rgba(0,255,242,0.35)';
    ctx.stroke();

    if (cracked) {
      // 3 jagged crack lines, deterministic per tile
      ctx.strokeStyle = 'rgba(10,10,15,0.9)';
      ctx.lineWidth = 2;
      for (let c = 0; c < 3; c++) {
        const sx = r.x + r.w * (0.2 + 0.6 * tileRand(i, c));
        const sy = r.y + r.h * (0.15 + 0.7 * tileRand(i, c + 7));
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (tileRand(i, c + 3) - 0.5) * 22, sy + (tileRand(i, c + 5) - 0.5) * 20);
        ctx.lineTo(sx + (tileRand(i, c + 4) - 0.5) * 30, sy + (tileRand(i, c + 6) - 0.5) * 26);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFallingTile(ctx, i, prog, now) {
    const r = tileRect(i);
    ctx.save();
    ctx.globalAlpha = 1 - prog;
    ctx.translate(0, prog * prog * 70);
    const s = 1 - prog * 0.45;
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(s, s);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
    ctx.fillStyle = 'rgba(0,255,242,0.04)';
    VP.roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,255,242,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(ctx, view, pid, isMe, now) {
    const p = view.players[pid];
    const color = VP.colors[(p.slot - 1) % 4];

    // soft pulse ring marks YOU
    if (isMe) {
      const k = 0.5 + 0.5 * Math.sin(now / 260);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.25 + 0.2 * k;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24 + k * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(p.x, p.y);

    // neon body — 4px glow per the VOIDPLAY shape spec
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    VP.roundRect(ctx, -15, -15, 30, 30, 7);
    ctx.fill();
    ctx.fill(); // double fill = brighter core glow
    ctx.shadowBlur = 0;

    // dark inner plate + facing eye
    ctx.fillStyle = '#0a0a0f';
    VP.roundRect(ctx, -10, -10, 20, 20, 5);
    ctx.fill();
    const ex = p.d >= 0 ? DX[p.d] * 4 : 0;
    const ey = p.d >= 0 ? DY[p.d] * 4 : 0;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(ex, ey, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // name label
    ctx.globalAlpha = 0.9;
    VP.text(ctx, p.name, p.x, p.y - 27, { size: 10, glow: color, blur: 6 });
    ctx.globalAlpha = 1;
  }

  function drawDeadPlayer(ctx, view, pid, now) {
    const t0 = view.anim.deaths[pid];
    if (t0 === undefined) return;
    const prog = (now - t0) / 700;
    if (prog >= 1) return;
    const p = view.players[pid];
    const color = VP.colors[(p.slot - 1) % 4];

    ctx.save();
    ctx.globalAlpha = 1 - prog;
    ctx.translate(p.x, p.y + prog * prog * 90);
    ctx.rotate(prog * 5);
    const s = 1 - prog * 0.8;
    ctx.scale(s, s);
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    VP.roundRect(ctx, -15, -15, 30, 30, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
})(window);
