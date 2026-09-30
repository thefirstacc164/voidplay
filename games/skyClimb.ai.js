// SKY CLIMB AI — picks the next ledge by reach and traffic, jumps clean,
// and doesn't crowd a platform someone else is already claiming.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.skyClimb = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var W = 800, H = 600;

  function snapshot(st, pid) {
    var others = [];
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al || Number(k) === pid) continue;
      others.push({ x: o.x, y: o.y, vy: o.vy || 0 });
    }
    return { others: others };
  }

  function think(st, p, skill, ctx) {
    var M = p.am || (p.am = {});
    var plats = ctx && ctx.plats ? ctx.plats() : [];
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st, p.pid !== undefined ? p.pid : Number(p.slot)); });

    // airborne: steer at the remembered landing spot
    if (!p.ground) {
      if (M.jx !== undefined) return { k: p.x < M.jx - 6 ? 8 : p.x > M.jx + 6 ? 4 : 0 };
      return { k: 0 };
    }

    var plan = AIC.plan(M, skill, st.t, function (prev) {
      var best = null, bestScore = -1e9;
      for (var i = 0; i < plats.length; i++) {
        var pl = plats[i];
        if (pl.y >= p.y - 6) continue;                  // above me only
        var dy = p.y - pl.y;
        if (dy > 200) continue;
        var near = AIC.clamp(p.x, pl.x + 10, pl.x + pl.w - 10);
        var dx = Math.abs(near - p.x);
        if (dx > 160) continue;
        var score = dy * 1.3 - dx * 0.8 + Math.random() * 6;
        // avoid ledges someone else is about to land on
        for (var j = 0; j < S.others.length; j++) {
          var o = S.others[j];
          if (Math.abs(o.x - near) < 46 && Math.abs(o.y - pl.y) < 60) score -= 55;
        }
        if (skill < 4) score += Math.random() * 35;
        if (score > bestScore) { bestScore = score; best = { x: near, y: pl.y }; }
      }
      if (!best) return { none: true };
      return best;
    });

    if (plan && plan.y !== undefined && plan.y >= p.y - 8) { AIC.replan(M); plan = null; }
    if (!plan || plan.none) return { k: 0 };
    M.jx = plan.x;
    var dx2 = plan.x - p.x;
    var k = 0;
    if (Math.abs(dx2) > 8) k = dx2 > 0 ? 8 : 4;
    if (Math.abs(dx2) < (skill >= 6 ? 18 : 32) && Math.random() > AIC.blunder(skill) * 0.3) k |= 16;
    return { k: k };
  }

  return { think: think };
});
