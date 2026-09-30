// LAVA FLOOR AI — climbs with intent: reads the ladder, picks a platform it
// can actually reach, jumps on a timer (reaction delay included), and
// remembers its target while airborne.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.lavaFloor = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var W = 800, H = 600;

  function think(st, p, skill, ctx) {
    var M = p.am || (p.am = {});
    var plats = ctx && ctx.plats ? ctx.plats() : [];
    var ly = ctx && ctx.lavaY ? ctx.lavaY(st.t) : H;

    // airborne: steer toward the remembered landing spot
    if (!p.ground) {
      if (M.jx !== undefined && (p.vy || 0) < 0) {
        return { k: p.x < M.jx - 6 ? 8 : p.x > M.jx + 6 ? 4 : 0 };
      }
      if (M.jx !== undefined) return { k: p.x < M.jx - 6 ? 8 : p.x > M.jx + 6 ? 4 : 0 };
      return { k: 0 };
    }

    // grounded: choose the platform to jump to (committed, re-read on reaction)
    var plan = AIC.plan(M, skill, st.t, function (prev) {
      var best = null, bestScore = -1e9;
      for (var i = 0; i < plats.length; i++) {
        var pl = plats[i];
        if (pl.y >= p.y - 4) continue;                   // must be above me
        if (pl.y > ly - 24) continue;                    // at/below the lava surface
        var dy = p.y - pl.y;
        if (dy > 132) continue;                          // out of jump reach (jump peaks ~137px)
        var near = AIC.clamp(p.x, pl.x + 12, pl.x + pl.w - 12);
        var dx = Math.abs(near - p.x);
        if (dx > 150) continue;                          // too far sideways
        var score = dy * 1.4 - dx * 0.9 + (pl.w - 100) * 0.05 + Math.random() * 8;
        // high skill prefers high, safe, central gains; low skill is sloppy
        if (skill < 4) score += Math.random() * 40;
        if (score > bestScore) { bestScore = score; best = { x: near, y: pl.y, w: pl.w }; }
      }
      if (!best) return { none: true };
      return best;
    });

    if (plan && plan.y !== undefined && plan.y >= p.y - 8) { AIC.replan(M); plan = AIC.plan(M, skill, st.t, function () { return null; }); plan = null; }
    if (!plan || plan.none) {
      // nothing directly reachable: sidle under the closest platform above
      var under = null, ud = 1e9;
      for (var u = 0; u < plats.length; u++) {
        var up = plats[u];
        if (up.y >= p.y - 4) continue;
        var unear = AIC.clamp(p.x, up.x + 12, up.x + up.w - 12);
        var udx = Math.abs(unear - p.x);
        if (udx < ud) { ud = udx; under = unear; }
      }
      if (under !== null && ud > 10) return { k: under > p.x ? 8 : 4 };
      return { k: 0 };
    }

    M.jx = plan.x;
    var dx2 = plan.x - p.x;
    var k = 0;
    if (Math.abs(dx2) > 8) k = dx2 > 0 ? 8 : 4;

    // jump when lined up; low skill mis-times the takeoff
    var window = Math.abs(dx2) < (skill >= 6 ? 20 : 34);
    if (window && Math.random() > AIC.blunder(skill) * 0.35) k |= 16;
    return { k: k };
  }

  return { think: think };
});
