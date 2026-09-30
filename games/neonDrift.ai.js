// NEON DRIFT AI — racing line driving: aims two corners ahead, brakes for
// the corner it's actually in, and lifts instead of pinning it everywhere.
// Speed comes from the line; mistakes come from the skill model.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.neonDrift = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  function think(st, p, skill, ctx) {
    var M = p.am || (p.am = {});
    var TRACK = ctx && ctx.TRACK, NWP = ctx && ctx.NWP;
    if (!TRACK || !NWP) return { tp: 1 };

    var S = AIC.see(M, skill, st.t, function () {
      return { wp: p.wp, x: p.x, y: p.y };
    });

    // lookahead grows with skill: pros steer to the corner after this one
    var look = skill >= 8 ? 2 : skill >= 5 ? 1.5 : 1;
    var t1 = TRACK[(S.wp + 1) % NWP];
    var t2 = TRACK[(S.wp + 2) % NWP];
    var tx = t1.x + (t2.x - t1.x) * (look - 1) * 0.5;
    var ty = t1.y + (t2.y - t1.y) * (look - 1) * 0.5;

    var dx = tx - p.x, dy = ty - p.y;
    var want = Math.atan2(dy, dx);
    var diff = ((want - p.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    // low skill over-corrects (wobbly hands on the wheel)
    diff *= 1 + AIC.blunder(skill) * 0.8;

    var tp = 1;                                     // throttle
    if (diff > 0.05) tp |= 8;
    else if (diff < -0.05) tp |= 4;
    // brake for the corner: threshold tightens with skill (pros brake late, once)
    var brakeAt = 0.62 - skill * 0.012;
    var fast = (p.sp || 0) > (skill >= 6 ? 185 : 150);
    if (Math.abs(diff) > brakeAt && fast) tp |= 16;
    return { tp: tp };
  }

  return { think: think };
});
