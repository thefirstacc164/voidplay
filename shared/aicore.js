// VOIDPLAY AI core — the shared brain model for every game bot.
// Skill 1-10. No 0ms reactions, no perfect aim: bots perceive the world on a
// reaction delay, commit to plans before reconsidering, and wobble their aim
// like a human hand. Higher skill = faster eyes, steadier hands, deeper plans.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AIC = api; }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // --- the skill model -------------------------------------------------
  // reaction: how stale the world snapshot may be (ms)
  function reactMs(skill) { return Math.round(560 - 49 * skill); }        // 1→511 ... 10→70
  // commitment: how long a plan is held before reconsidering (ms)
  function commitMs(skill) { return Math.round(600 - 49 * skill); }       // 1→551 ... 10→110
  // hand wobble: max angular error baked into every aim (radians)
  function aimErr(skill) { return 0.4 * Math.pow(0.71, skill - 1); }      // 1→0.40 ... 10→0.014
  // blunder chance for judgement calls (junctions, target picks)
  function blunder(skill) { return Math.max(0, 0.42 - skill * 0.042); }   // 1→0.38 ... 10→0

  function skillOf(p) { return clamp(Math.round((p && p.skill) || 4), 1, 10); }

  // room bots: trained between 3-5, occasionally 6-7, never higher
  function roomSkill() {
    var r = Math.random();
    return r < 0.5 ? 3 : r < 0.8 ? 4 : r < 0.93 ? 5 : r < 0.985 ? 6 : 7;
  }

  // --- perception ------------------------------------------------------
  // The bot only re-reads the world every reactMs. Between snapshots it plays
  // against what it last saw — dodge a rock that already moved, chase a spot
  // the target left. That's the reaction time, not a timer bolted on top.
  function see(M, skill, t, read) {
    if (M._w === undefined || t - M._wt >= reactMs(skill)) {
      M._w = read();
      M._wt = t;
    }
    return M._w;
  }
  function seenFresh(M, t) { return M._wt !== undefined && t - M._wt < 60; }

  // --- commitment ------------------------------------------------------
  // A plan is held until it expires (or is marked dead). The bot keeps running
  // its line even if the world changed — it only "realizes" on the next plan.
  function plan(M, skill, t, make) {
    if (M._p && t < M._pu && !M._p.dead) return M._p;
    var next = make(M._p);
    if (!next) { M._p = null; M._pu = t + 150; return null; }
    if (next.dead) next.dead = 0;
    M._p = next;
    M._pu = t + commitMs(skill) * (0.75 + Math.random() * 0.5);
    return M._p;
  }
  function replan(M) { if (M) M._pu = -1; }

  // --- hands -----------------------------------------------------------
  function norm(x, y) { var l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }
  function wob(M, skill, aim, t) {
    if (!M._ph) M._ph = Math.random() * 9;
    var e = aimErr(skill);
    var a = Math.atan2(aim.y, aim.x) + Math.sin(M._ph + t * 0.0045) * e + (Math.random() - 0.5) * e * 0.45;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  // steer toward a point, bending away from arena walls
  function seek(p, tx, ty, w, h, margin) {
    var a = norm(tx - p.x, ty - p.y);
    if (margin) {
      if (p.x < margin && a.x < 0) a = norm(a.x + (margin - p.x) / margin, a.y);
      if (w - p.x < margin && a.x > 0) a = norm(a.x - (margin - (w - p.x)) / margin, a.y);
      if (p.y < margin && a.y < 0) a = norm(a.x, a.y + (margin - p.y) / margin);
      if (h - p.y < margin && a.y > 0) a = norm(a.x, a.y - (margin - (h - p.y)) / margin);
    }
    return a;
  }

  // where will a moving target be when we get there
  function lead(px, py, tx, ty, tvx, tvy, spd) {
    var t = 0;
    for (var i = 0; i < 3; i++) {
      t = Math.hypot(tx + tvx * t - px, ty + tvy * t - py) / (spd || 200);
    }
    return { x: tx + tvx * t, y: ty + tvy * t, t: t };
  }

  // best escape direction given threats: maximizes room, hates walls/corners
  function flee(p, threats, w, h) {
    var bx = 1, by = 0, best = -1e9;
    for (var a = 0; a < 16; a++) {
      var ang = (a / 16) * Math.PI * 2;
      var dx = Math.cos(ang), dy = Math.sin(ang);
      var s = 0;
      for (var i = 0; i < threats.length; i++) {
        var th = threats[i];
        s += Math.min(340, Math.hypot(th.x - (p.x + dx * 130), th.y - (p.y + dy * 130)));
      }
      var fx = p.x + dx * 170, fy = p.y + dy * 170;
      s -= Math.max(0, 50 - fx) * 1.5 + Math.max(0, fx - (w - 50)) * 1.5;
      s -= Math.max(0, 50 - fy) * 1.5 + Math.max(0, fy - (h - 50)) * 1.5;
      if (s > best) { best = s; bx = dx; by = dy; }
    }
    return { x: bx, y: by };
  }

  // candidate scoring helper: angle sweep around a point
  function bestDir(p, scoreFn, n) {
    n = n || 16;
    var bx = 0, by = 0, best = -1e9;
    for (var a = 0; a < n; a++) {
      var ang = (a / n) * Math.PI * 2;
      var dx = Math.cos(ang), dy = Math.sin(ang);
      var s = scoreFn(dx, dy);
      if (s > best) { best = s; bx = dx; by = dy; }
    }
    return { x: bx, y: by, score: best };
  }

  return {
    clamp: clamp, reactMs: reactMs, commitMs: commitMs, aimErr: aimErr, blunder: blunder,
    skillOf: skillOf, roomSkill: roomSkill,
    see: see, seenFresh: seenFresh, plan: plan, replan: replan,
    norm: norm, wob: wob, seek: seek, lead: lead, flee: flee, bestDir: bestDir,
  };
});
