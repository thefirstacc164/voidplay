// COLOR RAID AI — paints in committed sweeps, not random walks.
// Picks the biggest foreign pocket near itself, sweeps a clean line through
// it, steals enemy ground when the board fills up.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.colorRaid = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var COLS = 16, ROWS = 12;
  var DIRX = [0, 0, -1, 1], DIRY = [-1, 1, 0, 0];

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var aim = p.aim || { x: 0, y: 0 };
    if (p.m) return { aim: aim };                        // finish the hop (commitment)

    var pid = p.pid !== undefined ? p.pid : Number(p.slot);

    // choose a target cell every reaction window
    var plan = AIC.plan(M, skill, st.t, function (prev) {
      var atTarget = prev && prev.tx !== undefined &&
        Math.abs(prev.tx - p.gx) + Math.abs(prev.ty - p.gy) <= 1;
      var stale = prev && prev.born !== undefined && st.t - prev.born > 4200;
      if (prev && !atTarget && !stale) return prev;

      // scan a window around me for the best pocket of not-mine cells
      var win = 4 + Math.round(skill * 0.8);             // smarter = sees farther
      var best = null, bestScore = -1e9;
      for (var dy = -win; dy <= win; dy++) {
        for (var dx = -win; dx <= win; dx++) {
          var nx = p.gx + dx, ny = p.gy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          var i = ny * COLS + nx;
          if (st.tiles[i] === pid) continue;
          var dist = Math.abs(dx) + Math.abs(dy);
          var foreign = st.tiles[i] !== 0 ? 1.6 : 1;      // stealing enemy ground pays
          var pocket = 0;
          for (var sy = -1; sy <= 1; sy++) {
            for (var sx = -1; sx <= 1; sx++) {
              var qx = nx + sx, qy = ny + sy;
              if (qx < 0 || qy < 0 || qx >= COLS || qy >= ROWS) continue;
              if (st.tiles[qy * COLS + qx] !== pid) pocket++;
            }
          }
          var score = pocket * 2.2 * foreign - dist * (1.15 - skill * 0.04) + Math.random() * 2;
          if (score > bestScore) { bestScore = score; best = { x: nx, y: ny }; }
        }
      }
      if (!best) {
        // my color everywhere nearby: range out for the farthest foreign cell
        for (var yy = 0; yy < ROWS; yy++) {
          for (var xx = 0; xx < COLS; xx++) {
            if (st.tiles[yy * COLS + xx] !== pid) { best = { x: xx, y: yy }; break; }
          }
          if (best) break;
        }
      }
      if (!best) return { tx: p.gx, ty: p.gy };
      return { tx: best.x, ty: best.y, born: st.t };
    });

    // step toward the target one hop at a time; prefer the axis with more
    // ground to gain, keep going straight through a run (sweep lines)
    var ddx = plan.tx - p.gx, ddy = plan.ty - p.gy;
    var cand = [];
    if (ddx !== 0) cand.push({ x: Math.sign(ddx), y: 0 });
    if (ddy !== 0) cand.push({ x: 0, y: Math.sign(ddy) });
    if (!cand.length) return { aim: { x: 0, y: 0 } };

    var dir = cand[0];
    if (cand.length > 1) {
      var keepStraight = (aim.x !== 0 || aim.y !== 0) &&
        cand.some(function (c) { return c.x === aim.x && c.y === aim.y; }) &&
        (Math.abs(ddx) + Math.abs(ddy)) > 1;
      if (!keepStraight || Math.random() < AIC.blunder(skill) * 0.3) {
        // choose the axis that gains more fresh ground
        var gainX = 0, gainY = 0;
        var cx = p.gx + cand[0].x, cy = p.gy;
        if (st.tiles[cy * COLS + cx] !== pid) gainX = 1;
        var cyy = p.gy + cand[1].y;
        if (st.tiles[cyy * COLS + p.gx] !== pid) gainY = 1;
        dir = gainX >= gainY ? cand[0] : cand[1];
      } else dir = { x: aim.x, y: aim.y };
    }

    // never hop off the board
    var nx2 = p.gx + dir.x, ny2 = p.gy + dir.y;
    if (nx2 < 0 || ny2 < 0 || nx2 >= COLS || ny2 >= ROWS) {
      dir = cand.find(function (c) {
        var q = p.gx + c.x, r = p.gy + c.y;
        return q >= 0 && r >= 0 && q < COLS && r < ROWS;
      }) || { x: 0, y: 0 };
    }
    return { aim: { x: dir.x, y: dir.y } };
  }

  return { think: think };
});
