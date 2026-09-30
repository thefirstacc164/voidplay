// KING OF THE HILL AI — takes the high ground and keeps it.
// Approaches from the quiet side, orbits the crown zone instead of parking
// on the rim, dashes to shove contested hill fights.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.kingOfTheHill = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var CX = 400, CY = 300, HR = 90, SPEED = 290;

  function snapshot(st, pid) {
    var others = [];
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al || Number(k) === pid) continue;
      others.push({ x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, dcd: o.dcd || 0 });
    }
    return { others: others };
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st, p.pid !== undefined ? p.pid : Number(p.slot)); });
    var dc = Math.hypot(p.x - CX, p.y - CY);

    // count who's already scrapping on the crown
    var onHill = 0;
    for (var ci = 0; ci < S.others.length; ci++) {
      if (Math.hypot(S.others[ci].x - CX, S.others[ci].y - CY) < HR) onHill++;
    }
    // crowded hill: only the two closest bots contest; the rest hold off the rim
    var closerThanMe = 0;
    for (var rk = 0; rk < S.others.length; rk++) {
      if (Math.hypot(S.others[rk].x - CX, S.others[rk].y - CY) < dc) closerThanMe++;
    }
    if (onHill >= 2 && closerThanMe >= 2 && dc > HR * 0.75 && dc < HR * 2.4 && Math.random() < 0.85) {
      var orbA = Math.atan2(p.y - CY, p.x - CX) + 0.5;
      var waitR = HR * 1.45;
      return { aim: AIC.wob(M, skill, AIC.seek(p, CX + Math.cos(orbA) * waitR, CY + Math.sin(orbA) * waitR, 800, 600, 40), st.t) };
    }

    if (dc > HR * 0.75) {
      // approach: aim at the hill, but bend around whoever else is inbound
      var aim = AIC.seek(p, CX, CY, 800, 600, 70);
      for (var i = 0; i < S.others.length; i++) {
        var o = S.others[i];
        var d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < 85) {
          var away = AIC.norm(p.x - o.x, p.y - o.y);
          aim = AIC.norm(aim.x + away.x * 0.8, aim.y + away.y * 0.8);
        }
      }
      if (Math.random() < AIC.blunder(skill) * 0.2) aim = AIC.wob(M, 1, aim, st.t);
      return { aim: AIC.wob(M, skill, aim, st.t) };
    }

    // on the hill: orbit the sweet zone, lean away from the rim, contest
    var tang = Math.atan2(p.y - CY, p.x - CX) + (skill >= 6 ? 0.85 : 0.5);
    var wantR = HR * (0.35 + ((p.slot || 1) % 3) * 0.14);   // spread out, don't stack
    var tx = CX + Math.cos(tang) * wantR, ty = CY + Math.sin(tang) * wantR;
    var aim = AIC.seek(p, tx, ty, 800, 600, 0);

    var tap = false;
    var near = null, nd = 1e9;
    for (var j = 0; j < S.others.length; j++) {
      var q = S.others[j];
      var qd = Math.hypot(q.x - p.x, q.y - p.y);
      if (qd < nd) { nd = qd; near = q; }
    }
    if (near && nd < 80 && (p.dcd || 0) <= 0 && Math.random() < 0.05 + skill * 0.012) {
      // shove them off the crown
      aim = AIC.norm(near.x + (near.vx || 0) * 0.2 - p.x, near.y + (near.vy || 0) * 0.2 - p.y);
      tap = true;
    }
    return { aim: AIC.wob(M, skill, aim, st.t), tap: tap };
  }

  return { think: think };
});
