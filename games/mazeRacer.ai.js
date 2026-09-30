// MAZE RACER AI — runs the BFS line to the goal. Skill is in the execution:
// reaction delay on reading the maze, corner cutting at speed, and a
// blunder chance of taking a wrong turn at a junction.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.mazeRacer = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  function think(st, p, skill, ctx) {
    var M = p.am || (p.am = {});
    var COLS = ctx && ctx.COLS, ROWS = ctx && ctx.ROWS, GOAL = ctx && ctx.GOAL;
    if (!COLS || !GOAL) return { aim: { x: 1, y: 0 } };

    // distance field to goal (built once by the game or by us)
    if (!st._aidist) {
      var dist = new Int16Array(COLS * ROWS).fill(-1);
      var q = [GOAL.r * COLS + GOAL.c];
      dist[q[0]] = 0;
      for (var qi = 0; qi < q.length; qi++) {
        var idx = q[qi];
        var r = (idx / COLS) | 0, c = idx % COLS;
        var g = st._grid[r][c];
        var nb = [];
        if (!(g & 1) && r > 0) nb.push(idx - COLS);
        if (!(g & 2) && c < COLS - 1) nb.push(idx + 1);
        if (!(g & 4) && r < ROWS - 1) nb.push(idx + COLS);
        if (!(g & 8) && c > 0) nb.push(idx - 1);
        for (var n = 0; n < nb.length; n++) {
          if (dist[nb[n]] === -1) { dist[nb[n]] = dist[idx] + 1; q.push(nb[n]); }
        }
      }
      st._aidist = dist;
    }

    var CELL = ctx.CELL || 32;
    var pgx = AIC.clamp((p.x / CELL) | 0, 0, COLS - 1);
    var pgy = AIC.clamp((p.y / CELL) | 0, 0, ROWS - 1);
    var here = pgy * COLS + pgx;

    // pick the next cell on the gradient, on a reaction delay
    var step = AIC.see(M, skill, st.t, function () {
      var dirs = [];
      var g = st._grid[pgy][pgx];
      if (!(g & 1) && pgy > 0) dirs.push(here - COLS);
      if (!(g & 2) && pgx < COLS - 1) dirs.push(here + 1);
      if (!(g & 4) && pgy < ROWS - 1) dirs.push(here + COLS);
      if (!(g & 8) && pgx > 0) dirs.push(here - 1);
      var best = null, bd = 1e9;
      for (var i = 0; i < dirs.length; i++) {
        var d = st._aidist[dirs[i]];
        if (d >= 0 && d < bd) { bd = d; best = dirs[i]; }
      }
      // blunder: a wrong turn at a junction (recovers on the next read)
      if (best !== null && dirs.length > 2 && Math.random() < AIC.blunder(skill) * 0.35) {
        var wrong = dirs.filter(function (x) { return x !== best && st._aidist[x] >= 0; });
        if (wrong.length) best = wrong[(Math.random() * wrong.length) | 0];
      }
      return { cell: best, d: bd };
    });

    if (step.cell === null || step.cell === undefined) return { aim: { x: 0, y: 0 } };
    var tx = ((step.cell % COLS) + 0.5) * CELL;
    var ty = (((step.cell / COLS) | 0) + 0.5) * CELL;

    // corner cut: aim through the cell when aligned with the one after it
    if (skill >= 7 && step.d !== undefined && step.d > 0 && step.d < 1e9) {
      tx += (tx - p.x) * 0.35;
      ty += (ty - p.y) * 0.35;
    }
    return { aim: AIC.wob(M, skill, AIC.norm(tx - p.x, ty - p.y), st.t) };
  }

  return { think: think };
});
