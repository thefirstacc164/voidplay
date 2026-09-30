// BUMPER KNOCK AI — plays the rim: picks the enemy closest to the edge,
// comes from the inside, and dashes through them at the right angle.
// Recovers to the middle when it's the one hanging out there.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.bumperKnock = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var CX = 400, CY = 300;

  function snapshot(st, pid) {
    var others = [];
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al || Number(k) === pid) continue;
      others.push({ pid: Number(k), x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0 });
    }
    return { others: others };
  }

  function think(st, p, skill, ctx) {
    var M = p.am || (p.am = {});
    var R = ctx && ctx.radius ? ctx.radius() : 260;
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st, p.pid !== undefined ? p.pid : Number(p.slot)); });

    var myR = Math.hypot(p.x - CX, p.y - CY);

    // hanging off the rim: recover, no hero plays
    if (myR > R - 60) {
      return { aim: AIC.wob(M, skill, AIC.norm(CX - p.x, CY - p.y), st.t) };
    }

    // pick the best victim: near the rim and near me, weighting knock angle
    var hunt = AIC.plan(M, skill, st.t, function () {
      var best = null, bestScore = -1e9;
      for (var i = 0; i < S.others.length; i++) {
        var o = S.others[i];
        var oR = Math.hypot(o.x - CX, o.y - CY);
        var rim = R - oR;                                    // distance to the edge
        var d = Math.hypot(o.x - p.x, o.y - p.y);
        var outward = AIC.norm(o.x - CX, o.y - CY);
        var meToO = AIC.norm(o.x - p.x, o.y - p.y);
        var alignment = outward.x * meToO.x + outward.y * meToO.y;  // am I inside them?
        var score = (300 - rim) * 0.9 + alignment * 140 - d * 0.4 + Math.random() * 10;
        if (score > bestScore) { bestScore = score; best = o; }
      }
      return { target: best };
    });

    if (!hunt.target) {
      var a = Math.atan2(p.y - CY, p.x - CX) + 0.7;
      return { aim: AIC.wob(M, skill, AIC.seek(p, CX + Math.cos(a) * (R * 0.5), CY + Math.sin(a) * (R * 0.5), 800, 600, 0), st.t) };
    }

    var t = hunt.target;
    // approach from the center side so contact sends them outward
    var out = AIC.norm(t.x - CX, t.y - CY);
    var standOff = { x: t.x - out.x * 46, y: t.y - out.y * 46 };
    var d = Math.hypot(t.x - p.x, t.y - p.y);

    var tap = false;
    var aim;
    if (d < 95 && (p.dcd || 0) <= 0 && myR < R - 95) {
      // strike through them toward the rim, leading their drift
      var lead = AIC.lead(p.x, p.y, t.x, t.y, t.vx, t.vy, 320);
      aim = AIC.norm(lead.x + out.x * 40 - p.x, lead.y + out.y * 40 - p.y);
      tap = Math.random() < 0.16 + skill * 0.025;
    } else {
      aim = AIC.norm(standOff.x - p.x, standOff.y - p.y);
    }
    return { aim: AIC.wob(M, skill, aim, st.t), tap: tap };
  }

  return { think: think };
});
