// LASER MAZE AI — lives in its corner's safe band, reading the sweep with a
// short lookahead. Proven band-tracking core; skill decides how sharply it
// corrects and how often it freezes in the lights.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.laserMaze = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var W = 800, H = 600;

  function think(st, p, skill, ctx) {
    var M = p.am || (p.am = {});
    if (!ctx || !ctx.axisWalls) return { aim: { x: 0, y: 0 } };
    var LASERS = ctx.LASERS || [];
    var laserPos = ctx.laserPos;

    var look = 220 + (skill >= 7 ? 60 : 0);
    var hP = ctx.axisWalls(st.t + look, false);
    var vP = ctx.axisWalls(st.t + look, true);

    var top = p.slot % 2 === 1;
    var left = p.slot < 3;
    var ty = top ? Math.min(hP[0] / 2, hP[0] - 26) : Math.max((hP[1] + H) / 2, hP[1] + 26);
    var tx = left ? Math.min(vP[0] / 2, vP[0] - 26) : Math.max((vP[1] + W) / 2, vP[1] + 26);

    // lapse: freeze in the lights — much rarer for a pro
    var lapse = Math.random() < 0.012 + AIC.blunder(skill) * 0.14;
    if (lapse) { tx = p.x; ty = p.y; }

    // proportional steering; softer hands at low skill
    var gain = 2.2 + skill * 0.24;
    var ax = AIC.clamp((tx - p.x) * gain, -250, 250);
    var ay = AIC.clamp((ty - p.y) * gain, -250, 250);

    // per-laser sidestep: shove away from a wall line about to sweep over me
    if (!lapse && laserPos) {
      for (var i = 0; i < LASERS.length; i++) {
        var L = LASERS[i];
        var pos = laserPos(st.t + 120, L);
        if (L.vert) {
          var dx = p.x - pos;
          if (Math.abs(dx) < 48) ax += (dx >= 0 ? 1 : -1) * (1 - Math.abs(dx) / 48) * 300;
        } else {
          var dy = p.y - pos;
          if (Math.abs(dy) < 48) ay += (dy >= 0 ? 1 : -1) * (1 - Math.abs(dy) / 48) * 300;
        }
      }
    }
    var aim = AIC.norm(ax, ay);
    if (!aim.x && !aim.y) return { aim: { x: 0, y: 0 } };
    return { aim: AIC.wob(M, skill, aim, st.t) };
  }

  return { think: think };
});
