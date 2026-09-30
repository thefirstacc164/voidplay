// GRAVITY WELL AI — farms orbs by value over risk: near the core pays more
// but the pull can drag you in. Skilled bots orbit the sweet ring, cut
// outward arcs against the pull, and never dive past what they can climb out of.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.gravityWell = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var CX = 400, CY = 300, W = 800, H = 600;

  function snapshot(st) {
    var orbs = [];
    for (var k in st.en) {
      var e = st.en[k];
      orbs.push({ x: e.x, y: e.y, r: Math.hypot(e.x - CX, e.y - CY) });
    }
    return { orbs: orbs };
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st); });

    var r = Math.hypot(p.x - CX, p.y - CY);

    // too deep: everything outward
    if (r < 110 + (10 - skill) * 3) {
      return { aim: AIC.wob(M, skill, AIC.norm(p.x - CX, p.y - CY), st.t) };
    }

    var plan = AIC.plan(M, skill, st.t, function (prev) {
      if (prev && prev.orb !== undefined) {
        for (var c = 0; c < S.orbs.length; c++) {
          if (S.orbs[c].x === prev.orb.x && S.orbs[c].y === prev.orb.y) return prev;
        }
      }
      var best = null, bestScore = -1e9;
      for (var i = 0; i < S.orbs.length; i++) {
        var o = S.orbs[i];
        if (o.r < 90) continue;                                  // suicide orbs
        var d = Math.hypot(o.x - p.x, o.y - p.y);
        // risk: how far inside the danger ring the pick is
        var risk = Math.max(0, 170 - o.r) * (1.4 - skill * 0.06);
        var score = 260 - d * 0.55 - risk * 1.6 + Math.random() * 12;
        if (score > bestScore) { bestScore = score; best = o; }
      }
      return { orb: best };
    });

    if (!plan.orb) {
      // idle: circle the safe ring
      var a = Math.atan2(p.y - CY, p.x - CX) + 0.6;
      return { aim: AIC.wob(M, skill, AIC.seek(p, CX + Math.cos(a) * 230, CY + Math.sin(a) * 230, W, H, 40), st.t) };
    }

    // approach with an outward bias so the pull slides us, not drags us
    var toOrb = AIC.norm(plan.orb.x - p.x, plan.orb.y - p.y);
    var out = AIC.norm(p.x - CX, p.y - CY);
    var bias = Math.max(0, (200 - plan.orb.r) / 200) * (skill >= 6 ? 0.55 : 0.8);
    return { aim: AIC.wob(M, skill, AIC.norm(toOrb.x + out.x * bias, toOrb.y + out.y * bias), st.t) };
  }

  return { think: think };
});
