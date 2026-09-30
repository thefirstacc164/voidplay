// SNAKE PIT AI — eats orbs but counts its exits first.
// Candidate hops are scored on immediate survival, then reachable free space
// (flood fill: "if I go there, can I still turn around?"), then food.
// Big snakes at high skill switch to tail-chasing when space runs low.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.snakePit = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    // perception gate: how often it re-reads the pit
    var S = AIC.see(M, skill, st.t, function () { return { t: st.t }; });

    var COLS = 32, ROWS = 24;
    var head = p.body[0];
    var hx = head % COLS, hy = (head / COLS) | 0;

    // occupancy: my body + every other snake's body
    var occ = {};
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al) continue;
      for (var b = 0; b < o.body.length; b++) {
        if (o === p && b === o.body.length - 1) continue;  // my tail moves away
        occ[o.body[b]] = 1;
      }
    }

    // orbs
    var orbs = [];
    for (var oid in st.en) orbs.push(st.en[oid].g);

    var DIRX = [0, 0, -1, 1], DIRY = [-1, 1, 0, 0];

    // free space from a cell (capped flood fill)
    function roomFrom(cell) {
      var seen = {}; var q = [cell]; seen[cell] = 1; var n = 0;
      var cap = 90;
      while (q.length && n < cap) {
        var c = q.shift();
        var x = c % COLS, y = (c / COLS) | 0;
        for (var d = 0; d < 4; d++) {
          var nx = x + DIRX[d], ny = y + DIRY[d];
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          var ni = ny * COLS + nx;
          if (seen[ni] || occ[ni]) continue;
          seen[ni] = 1; n++;
          q.push(ni);
        }
      }
      return n;
    }

    var myLen = p.body.length;
    var wantSpace = Math.min(60, myLen + 6);
    var useFlood = true;
    var bestDir = -1, bestScore = -1e9;

    for (var dir = 0; dir < 4; dir++) {
      if (p.d === 0 && dir === 1) continue;
      if (p.d === 1 && dir === 0) continue;
      if (p.d === 2 && dir === 3) continue;
      if (p.d === 3 && dir === 2) continue;
      var nx2 = hx + DIRX[dir], ny2 = hy + DIRY[dir];
      if (nx2 < 0 || ny2 < 0 || nx2 >= COLS || ny2 >= ROWS) continue;
      var ni2 = ny2 * COLS + nx2;
      if (occ[ni2]) continue;                       // fatal, never

      var score = 40;

      // food: nearest orb from the candidate
      var bestFood = 1e9;
      for (var oi = 0; oi < orbs.length; oi++) {
        var g = orbs[oi];
        var gd = Math.abs(g % COLS - nx2) + Math.abs(((g / COLS) | 0) - ny2);
        if (gd < bestFood) bestFood = gd;
      }
      if (bestFood < 1e9) score += Math.max(0, 30 - bestFood) * (skill >= 5 ? 1.4 : 1);

      // space: will I be able to keep turning?
      if (useFlood) {
        var room = roomFrom(ni2);
        score += Math.min(room, wantSpace) * (skill >= 7 ? 1.2 : 0.9);
        if (room < myLen * 0.7) score -= (skill >= 6 ? 120 : 40);
      }

      // avoid parking next to a longer snake's head (it can cut into us)
      if (skill >= 6) {
        for (var kk in st.p) {
          var other = st.p[kk];
          if (other === p || !other.al) continue;
          var oh = other.body[0];
          var od = Math.abs(oh % COLS - nx2) + Math.abs(((oh / COLS) | 0) - ny2);
          if (od === 1 && other.body.length >= myLen) score -= 25;
        }
      }

      score += Math.random() * 4;
      if (score > bestScore) { bestScore = score; bestDir = dir; }
    }

    if (bestDir < 0) {
      // trapped: any legal move, even reversing-ish, to buy one more tick
      for (var d2 = 0; d2 < 4; d2++) {
        if ((p.d === 0 && d2 === 1) || (p.d === 1 && d2 === 0) || (p.d === 2 && d2 === 3) || (p.d === 3 && d2 === 2)) continue;
        var fx = hx + DIRX[d2], fy = hy + DIRY[d2];
        if (fx < 0 || fy < 0 || fx >= COLS || fy >= ROWS) continue;
        if (occ[fy * COLS + fx]) continue;
        bestDir = d2;
        break;
      }
    }
    if (bestDir < 0) bestDir = p.d || 3;

    // blunder: rookies occasionally ignore everything and wing it
    if (Math.random() < AIC.blunder(skill) * 0.12) {
      var opts = [];
      for (var d3 = 0; d3 < 4; d3++) {
        if ((p.d === 0 && d3 === 1) || (p.d === 1 && d3 === 0) || (p.d === 2 && d3 === 3) || (p.d === 3 && d3 === 2)) continue;
        opts.push(d3);
      }
      if (opts.length) bestDir = opts[(Math.random() * opts.length) | 0];
    }

    return { k: 1 << bestDir };                     // keys: 1 up, 2 down, 4 left, 8 right
  }

  return { think: think };
});
