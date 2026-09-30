// ASTEROID STORM AI — reads each rock's time-to-impact at my row and sidesteps
// the landing zone, drifting low-field where the warning time is longest.
// Reaction delay on new rocks + skill-scaled lapses make the human mistakes.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.asteroidStorm = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var W = 800, H = 600;

  function snapshot(st) {
    var rocks = [];
    for (var k in st.en) {
      var e = st.en[k];
      if (e.w) continue;                              // w = warning/fx entries
      rocks.push({ x: e.x, y: e.y, vx: e.vx || 0, vy: e.vy || 200, r: e.r || 14 });
    }
    return { rocks: rocks };
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st); });

    // lapse: low skill reads the sky wrong and just wanders
    if (Math.random() < AIC.blunder(skill) * 0.1) {
      return { aim: { x: Math.sin(st.t / 500 + (p.slot || 1) * 3.1) * 0.55, y: 0.18 } };
    }

    var ax = Math.sin(st.t / 800 + (p.slot || 1) * 2.1) * 0.3 + (W / 2 - p.x) / 1400;
    var ay = 0.25;
    var threat = 0;
    var margin = 26 + skill * 3.5;          // pros respect a wider blast radius
    var ttaMax = 1.2 + skill * 0.09;        // and read further ahead
    for (var i = 0; i < S.rocks.length; i++) {
      var e = S.rocks[i];
      if (e.y < p.y - 200 || e.y > H) continue;
      var tta = (p.y - e.y) / (e.vy || 200);
      if (tta < 0 || tta > ttaMax) continue;
      var ix = e.x + e.vx * tta;            // where it lands at my row
      if (Math.abs(ix - p.x) < e.r + margin) {
        ax += Math.sign(p.x - ix || (Math.random() - 0.5)) * (0.85 + skill * 0.03);
        threat = 1;
      }
    }
    if (!threat) ay = 0.15 + Math.sin(st.t / 900 + (p.slot || 1)) * 0.25;
    return { aim: AIC.wob(M, skill, AIC.norm(ax, ay), st.t) };
  }

  return { think: think };
});
