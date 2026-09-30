// PIXEL PAINT AI — paints sweep lines, not scribbles.
// Finds the nearest unpainted pocket, drives a straight pass through it, and
// only lifts the brush (picks a new target) when the run is spent.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.pixelPaint = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var W = 800, H = 600;
  var COLS = 40, ROWS = 30, CELL = 20;

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var pid = p.pid !== undefined ? p.pid : Number(p.slot);

    var plan = AIC.plan(M, skill, st.t, function (prev) {
      var done = prev && prev.x !== undefined &&
        (Math.hypot(prev.x - p.x, prev.y - p.y) < 26 || st.tiles[prev.gy * COLS + prev.gx] === pid);
      if (prev && !done) return prev;

      // nearest non-mine cell, spiral out
      var pgx = AIC.clamp((p.x / CELL) | 0, 0, COLS - 1);
      var pgy = AIC.clamp((p.y / CELL) | 0, 0, ROWS - 1);
      for (var r = 1; r < 9 + skill; r++) {
        var best = null, bd = 1e9;
        for (var dy = -r; dy <= r; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            var nx = pgx + dx, ny = pgy + dy;
            if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
            if (st.tiles[ny * COLS + nx] === pid) continue;
            var d = Math.abs(dx) + Math.abs(dy) + Math.random() * 2;
            if (d < bd) { bd = d; best = { gx: nx, gy: ny }; }
          }
        }
        if (best) {
          var px = best.gx * CELL + CELL / 2, py = best.gy * CELL + CELL / 2;
          return { x: px, y: py, gx: best.gx, gy: best.gy };
        }
      }
      var fx = ((Math.random() * COLS) | 0) * CELL + CELL / 2;
      var fy = ((Math.random() * ROWS) | 0) * CELL + CELL / 2;
      return { x: fx, y: fy, gx: (fx / CELL) | 0, gy: (fy / CELL) | 0 };
    });

    // blunder: rookies sometimes pick a fresh target early (scribble)
    if (Math.random() < AIC.blunder(skill) * 0.01) AIC.replan(M);

    return { aim: AIC.wob(M, skill, AIC.seek(p, plan.x, plan.y, W, H, 30), st.t) };
  }

  return { think: think };
});
