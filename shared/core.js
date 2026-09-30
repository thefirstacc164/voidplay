(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VP = root.VP || {};
  root.VP.S = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  var COLORS = ['#00fff2', '#ff00e4', '#39ff14', '#ff6600'];
  var DIRX = [0, 0, -1, 1];
  var DIRY = [-1, 1, 0, 0];
  var ROUND = { x: 1, y: 1, vx: 1, vy: 1, px: 1, py: 1 };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function keysDir(k) {
    var x = (k & 8 ? 1 : 0) - (k & 4 ? 1 : 0);
    var y = (k & 2 ? 1 : 0) - (k & 1 ? 1 : 0);
    if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    return { x: x, y: y };
  }

  function dirFromKeys(k) { return k & 1 ? 0 : k & 2 ? 1 : k & 4 ? 2 : k & 8 ? 3 : -1; }

  function aimDir(p) {
    if (p.aim && (p.aim.x || p.aim.y)) {
      var l = Math.hypot(p.aim.x, p.aim.y);
      return { x: p.aim.x / l, y: p.aim.y / l };
    }
    return keysDir(p.k || 0);
  }

  function latch(p, k) {
    k &= 63;
    p.tp = (p.tp || 0) | (k & ~(p.lk || 0));
    p.lk = k;
    p.k = k;
  }

  function endInput(p) { p.pk = p.k || 0; p.tp = 0; }

  function drive(p, dt, o) {
    var d = aimDir(p);
    var f = Math.exp(-(o.friction === undefined ? 4 : o.friction) * dt);
    p.vx = p.vx * f + d.x * o.speed * (1 - f);
    p.vy = p.vy * f + d.y * o.speed * (1 - f);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    var sp = Math.hypot(p.vx, p.vy);
    if (sp > 40) { p.fx = p.vx / sp; p.fy = p.vy / sp; }
    else if (d.x || d.y) { p.fx = d.x; p.fy = d.y; }
  }

  function tickCd(p, dt) {
    if (p.dcd > 0) p.dcd = Math.max(0, p.dcd - dt * 1000);
    if (p.dashT > 0) p.dashT = Math.max(0, p.dashT - dt * 1000);
  }

  function dash(p, o) {
    if (!(p.tp & 16) || p.dcd > 0) return false;
    var fx = p.fx || 0, fy = p.fy || 1;
    var l = Math.hypot(fx, fy) || 1;
    p.vx += (fx / l) * o.power;
    p.vy += (fy / l) * o.power;
    p.dcd = o.cd;
    p.dashT = 200;
    return true;
  }

  function bounce(a, b, ra, rb, o) {
    o = o || {};
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.hypot(dx, dy), min = ra + rb;
    if (d === 0) { d = 0.01; dx = 0.01; dy = 0; }
    if (d >= min) return false;
    var nx = dx / d, ny = dy / d;
    var ma = o.ma || 1, mb = o.mb || 1, tot = ma + mb;
    var push = min - d;
    a.x -= nx * push * (mb / tot); a.y -= ny * push * (mb / tot);
    b.x += nx * push * (ma / tot); b.y += ny * push * (ma / tot);
    var va = a.vx * nx + a.vy * ny, vb = b.vx * nx + b.vy * ny;
    if (va - vb <= 0) return true;
    var e = o.e === undefined ? 0.9 : o.e;
    var ia = (va * (ma - mb) + (1 + e) * mb * vb) / tot;
    var ib = (vb * (mb - ma) + (1 + e) * ma * va) / tot;
    a.vx += (ia - va) * nx; a.vy += (ia - va) * ny;
    b.vx += (ib - vb) * nx; b.vy += (ib - vb) * ny;
    return true;
  }

  function wallsRect(p, w, h, r, b) {
    var hit = false;
    if (p.x < r) { p.x = r; if (p.vx < 0) p.vx = -p.vx * b; hit = true; }
    if (p.x > w - r) { p.x = w - r; if (p.vx > 0) p.vx = -p.vx * b; hit = true; }
    if (p.y < r) { p.y = r; if (p.vy < 0) p.vy = -p.vy * b; hit = true; }
    if (p.y > h - r) { p.y = h - r; if (p.vy > 0) p.vy = -p.vy * b; hit = true; }
    return hit;
  }

  function wallsCircle(p, cx, cy, R, r, b) {
    var dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
    if (d <= R - r) return false;
    var nx = dx / (d || 1), ny = dy / (d || 1);
    p.x = cx + nx * (R - r); p.y = cy + ny * (R - r);
    var vn = p.vx * nx + p.vy * ny;
    if (vn > 0) { p.vx -= (1 + b) * vn * nx; p.vy -= (1 + b) * vn * ny; }
    return true;
  }

  function offCircle(p, cx, cy, R) { return Math.hypot(p.x - cx, p.y - cy) > R; }

  function segHit(ax, ay, bx, by, cx, cy, r) {
    var dx = bx - ax, dy = by - ay;
    var l2 = dx * dx + dy * dy || 1;
    var t = clamp(((cx - ax) * dx + (cy - ay) * dy) / l2, 0, 1);
    return Math.hypot(ax + dx * t - cx, ay + dy * t - cy) <= r;
  }

  function hopStep(st, p, cfg) {
    if (p.m) {
      var t = (st.t - p.ms) / cfg.moveMs;
      if (t >= 1) {
        if (cfg.onLeave) cfg.onLeave(st, p, p.gy * cfg.cols + p.gx);
        p.gx += DIRX[p.d]; p.gy += DIRY[p.d];
        p.m = 0;
        p.x = cfg.offX + (p.gx + 0.5) * cfg.cellW;
        p.y = cfg.offY + (p.gy + 0.5) * cfg.cellH;
        if (cfg.onLand) cfg.onLand(st, p);
      } else {
        p.x = cfg.offX + (p.gx + 0.5 + DIRX[p.d] * t) * cfg.cellW;
        p.y = cfg.offY + (p.gy + 0.5 + DIRY[p.d] * t) * cfg.cellH;
      }
      return;
    }
    var dir = -1;
    if (p.aim && (p.aim.x || p.aim.y)) {
      dir = Math.abs(p.aim.x) > Math.abs(p.aim.y) ? (p.aim.x > 0 ? 3 : 2) : (p.aim.y > 0 ? 1 : 0);
    } else dir = dirFromKeys(p.k || 0);
    if (dir < 0) return;
    p.d = dir;
    var nx = p.gx + DIRX[dir], ny = p.gy + DIRY[dir];
    if (nx < 0 || ny < 0 || nx >= cfg.cols || ny >= cfg.rows) return;
    if (cfg.canEnter && !cfg.canEnter(st, nx, ny)) return;
    p.m = 1; p.ms = st.t;
  }

  function platStep(st, p, dt, o) {
    var wantJump = (p.tp & 16) || (p.k & 16);
    var d = aimDir(p);
    var f = Math.exp(-o.friction * dt);
    p.vx = p.vx * f + d.x * o.speed * (1 - f);
    p.vy += o.grav * dt;
    if (wantJump && p.ground) { p.vy = -o.jump; p.ground = 0; }
    var py = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < o.r) { p.x = o.r; p.vx = Math.abs(p.vx) * 0.2; }
    if (p.x > o.w - o.r) { p.x = o.w - o.r; p.vx = -Math.abs(p.vx) * 0.2; }
    p.ground = 0;
    var plats = o.plats;
    for (var i = 0; i < plats.length; i++) {
      var pl = plats[i];
      if (p.vy >= 0 && py <= pl.y + 4 && p.y >= pl.y - 2 &&
          p.x > pl.x - o.r * 0.6 && p.x < pl.x + pl.w + o.r * 0.6) {
        p.y = pl.y; p.vy = 0; p.ground = 1;
        break;
      }
    }
  }

  function genLadder(seed, rows, gap, w, minW, maxW) {
    var r = rng(seed), out = [], lx = w / 2;
    for (var i = 0; i < rows; i++) {
      var y = (i + 1) * gap;
      var pw = minW + r() * (maxW - minW);
      var x = clamp(lx + (r() - 0.5) * 220 - pw / 2, 16, w - 16 - pw);
      lx = x + pw / 2;
      out.push({ x: x, y: y, w: pw });
      if (r() < 0.45) {
        var pw2 = minW + r() * (maxW - minW);
        var x2 = clamp(x + (r() < 0.5 ? -1 : 1) * (pw + 60 + r() * 120), 16, w - 16 - pw2);
        if (x2 > x + pw + 20 || x2 + pw2 < x - 20) out.push({ x: x2, y: y, w: pw2 });
      }
    }
    return out;
  }

  function genMaze(seed, cols, rows) {
    var r = rng(seed);
    var cells = [];
    for (var i = 0; i < cols * rows; i++) cells.push(15);
    var stack = [0];
    var seen = [1];
    var DXm = [0, 1, 0, -1];
    var DYm = [-1, 0, 1, 0];
    var OPP = [2, 3, 0, 1];
    while (stack.length) {
      var c = stack[stack.length - 1];
      var cx = c % cols, cy = (c / cols) | 0;
      var opts = [];
      for (var d = 0; d < 4; d++) {
        var nx = cx + DXm[d], ny = cy + DYm[d];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var ni = ny * cols + nx;
        if (!seen[ni]) opts.push([d, ni]);
      }
      if (!opts.length) { stack.pop(); continue; }
      var pick = opts[(r() * opts.length) | 0];
      cells[c] &= ~(1 << pick[0]);
      cells[pick[1]] &= ~(1 << OPP[pick[0]]);
      seen[pick[1]] = 1;
      stack.push(pick[1]);
    }
    cells[cols * rows - 1] &= ~2;
    return cells;
  }

  function pd(a, b, fields) {
    if (!b) {
      var o = {};
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        o[f] = ROUND[f] ? Math.round(a[f] || 0) : a[f];
      }
      return o;
    }
    var d = null;
    for (var j = 0; j < fields.length; j++) {
      var fl = fields[j];
      var av = ROUND[fl] ? Math.round(a[fl] || 0) : a[fl];
      var bv = ROUND[fl] ? Math.round(b[fl] || 0) : b[fl];
      if (av !== bv) { if (!d) d = {}; d[fl] = av; }
    }
    return d;
  }

  function ed(cur, last, fields) {
    var up = null, rm = null;
    for (var id in cur) {
      var d = pd(cur[id], last && last[id], fields);
      if (d) { if (!up) up = {}; up[id] = d; }
    }
    if (last) {
      for (var oid in last) {
        if (!cur[oid]) { if (!rm) rm = []; rm.push(Number(oid)); }
      }
    }
    return (up || rm) ? { eu: up, er: rm } : null;
  }

  function rank(st, key) {
    var ids = Object.keys(st.p).map(Number);
    ids.sort(function (a, b) {
      var pa = st.p[a], pb = st.p[b];
      if (pa.al !== pb.al) return pa.al ? -1 : 1;
      if (key) return (pb[key] || 0) - (pa[key] || 0);
      return pb.deathT - pa.deathT;
    });
    return ids;
  }

  var fxEmit = function () {};
  function fx(type, data) { fxEmit(type, data); }
  fx.set = function (fn) { fxEmit = fn || function () {}; };

  function rrect(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var FONT = '"system-ui", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
  function text(ctx, str, x, y, o) {
    o = o || {};
    ctx.font = '700 ' + (o.size || 16) + 'px ' + FONT;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    ctx.shadowColor = o.glow || o.color || '#00fff2';
    ctx.shadowBlur = o.blur === undefined ? 10 : o.blur;
    ctx.fillStyle = o.color || '#ffffff';
    ctx.fillText(str, x, y);
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
  }

  function polyPath(ctx, n, size, rot) {
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = rot + i / n * Math.PI * 2;
      var x = Math.cos(a) * size, y = Math.sin(a) * size;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function starPath(ctx, size) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i / 10 * Math.PI * 2;
      var r = i % 2 ? size * 0.45 : size;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function shape(ctx, x, y, id, size, color, glow) {
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = color;
    ctx.shadowBlur = glow === undefined ? 4 : glow;
    ctx.fillStyle = color;
    if (id === 'ci') { ctx.beginPath(); ctx.arc(0, 0, size, 0, 6.2832); ctx.fill(); }
    else if (id === 'tr') { polyPath(ctx, 3, size * 1.2, -Math.PI / 2); ctx.fill(); }
    else if (id === 'hx') { polyPath(ctx, 6, size * 1.05, 0); ctx.fill(); }
    else if (id === 'dm') { polyPath(ctx, 4, size * 1.1, 0); ctx.fill(); }
    else if (id === 'st') { starPath(ctx, size * 1.25); ctx.fill(); }
    else { rrect(ctx, -size, -size, size * 2, size * 2, size * 0.45); ctx.fill(); }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function meRing(ctx, x, y, color, now) {
    var k = 0.5 + 0.5 * Math.sin(now / 260);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.25 + 0.2 * k;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 24 + k * 3, 0, 6.2832);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  return {
    COLORS: COLORS, DIRX: DIRX, DIRY: DIRY,
    clamp: clamp, lerp: lerp, dist: dist, rng: rng,
    keysDir: keysDir, dirFromKeys: dirFromKeys, aimDir: aimDir,
    latch: latch, endInput: endInput,
    drive: drive, tickCd: tickCd, dash: dash, bounce: bounce,
    wallsRect: wallsRect, wallsCircle: wallsCircle, offCircle: offCircle, segHit: segHit,
    hopStep: hopStep, platStep: platStep, genLadder: genLadder, genMaze: genMaze,
    pd: pd, ed: ed, rank: rank,
    fx: fx, rrect: rrect, text: text, shape: shape, polyPath: polyPath, starPath: starPath, meRing: meRing
  };
});
