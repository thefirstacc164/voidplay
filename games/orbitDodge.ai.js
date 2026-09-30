// ORBIT DODGE AI — rides the ring just inside the first planet orbit, matching
// the beams' rotation so the gaps come to it. Proven line-following core with
// skill-scaled wobble, lapse, and steering sharpness.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.orbitDodge = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var CX = 400, CY = 300;
  var BEAMS = 3;

  function think(st, p, skill, ctx) {
    var M = p.am || (p.am = {});
    if (!ctx || !ctx.beamAngle) return { aim: { x: 0, y: 0 } };
    var ORBITS = (ctx && ctx.ORBITS) || [];
    var planetPos = ctx.planetPos;

    var ax = 0, ay = 0;
    var dx = p.x - CX, dy = p.y - CY;
    var r = Math.hypot(dx, dy) || 1;
    var theta = Math.atan2(dy, dx);

    // gap tracking: rotate with the beams toward the nearest sector center
    var angs = [];
    for (var i = 0; i < BEAMS; i++) angs.push(ctx.beamAngle(st.t, i));
    angs.sort(function (a, b) { return a - b; });
    var want = angs[0] + Math.PI / 6, bestD = 1e9;
    for (var g = 0; g < BEAMS * 2; g++) {
      var cand = angs[0] + Math.PI / 6 + g * Math.PI / BEAMS;
      var cd = Math.abs(((cand - theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (cd < bestD) { bestD = cd; want = cand; }
    }
    var diff = ((want - theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    var om = (ctx.beamAngle(st.t + 16, 0) - ctx.beamAngle(st.t, 0)) / 16;
    var sharp = 0.55 + skill * 0.055;                 // steering firmness by skill
    var vt = om * r + diff * 170 * sharp;
    if (vt > 265) vt = 265;
    if (vt < -265) vt = -265;
    var vr = (85 - r) * 4;
    if (vr > 130) vr = 130;
    if (vr < -130) vr = -130;
    ax += -Math.sin(theta) * vt + Math.cos(theta) * vr;
    ay += Math.cos(theta) * vt + Math.sin(theta) * vr;

    // beam proximity: sidestep the sweep line
    for (var i2 = 0; i2 < BEAMS; i2++) {
      var a2 = ctx.beamAngle(st.t, i2);
      var sd = Math.sin(theta - a2);
      if (Math.abs(sd) * r < 40) {
        var side = sd >= 0 ? 1 : -1;
        ax += -Math.sin(a2) * 1.6 * side * sharp;
        ay += Math.cos(a2) * 1.6 * side * sharp;
      }
    }

    // planets, read ahead
    if (planetPos) {
      for (var j = 0; j < ORBITS.length; j++) {
        var o = planetPos(st.t + 400, ORBITS[j]);
        var pdx = p.x - o.x, pdy = p.y - o.y;
        var pd = Math.hypot(pdx, pdy) || 1;
        if (pd < 110) { ax += pdx / pd * (1 - pd / 110) * 1.4; ay += pdy / pd * (1 - pd / 110) * 1.4; }
      }
    }

    // human hands: gentle drift + wobble; low skill sometimes freezes
    ax += Math.sin(st.t / 900 + p.slot * 2.9) * 0.08;
    ay += Math.cos(st.t / 1100 + p.slot * 1.3) * 0.08;
    var l = Math.hypot(ax, ay);
    var aim;
    if (l > 0.05) aim = { x: ax / l, y: ay / l };
    else aim = { x: -dy / r, y: dx / r };
    if (Math.random() < AIC.blunder(skill) * 0.25) aim = { x: 0, y: 0 };
    return { aim: AIC.wob(M, skill, aim, st.t) };
  }

  return { think: think };
});
