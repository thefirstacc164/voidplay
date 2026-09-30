// TILE COLLAPSE AI — thinks in escapes, not steps.
// "If I hop there, can I still get out?" — flood-fills the reachable safe
// region behind every candidate hop before committing. Low skill sees one
// tile ahead; high skill sees the whole board and never traps itself.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.tileCollapse = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var COLS = 12, ROWS = 10, CRACK_MS = 800, FALL_MS = 500;

  function idx(x, y) { return y * COLS + x; }

  // how much room is reachable from (x,y)? cracked tiles count as half-open
  // (they fall within ~FALL_MS but might be crossed once). fallen tiles block.
  function space(st, sx, sy, limit) {
    var seen = {};
    var q = [idx(sx, sy)];
    seen[q[0]] = 1;
    var room = 0, risky = 0;
    limit = limit || 200;
    while (q.length && room + risky < limit) {
      var i = q.shift();
      var x = i % COLS, y = (i / COLS) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = x + [0, 0, -1, 1][d], ny = y + [-1, 1, 0, 0][d];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        var ni = idx(nx, ny);
        if (seen[ni]) continue;
        var t = st.tiles[ni];
        if (t === 2) continue;
        seen[ni] = 1;
        if (t === 1) risky++;
        else room++;
        q.push(ni);
      }
    }
    return { room: room, risky: risky };
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var aim = p.aim || { x: 0, y: 0 };
    if (p.m) return { aim: aim };  // mid-hop: see the hop through (commitment)

    var W = AIC.see(M, skill, st.t, function () { return { t: st.t }; });

    // hop cadence IS the reaction gate at high skill; at low skill add drift
    var candidates = [];
    var cur = idx(p.gx, p.gy);
    for (var d = 0; d < 4; d++) {
      var nx = p.gx + [0, 0, -1, 1][d], ny = p.gy + [-1, 1, 0, 0][d];
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      var i = idx(nx, ny);
      if (st.tiles[i] === 2) continue;

      var score = 30;

      // the tile I'd stand on: fresh > cracking soon > cracking now
      if (st.tiles[i] === 1) score -= 45;                     // cracked: falls any moment
      else if (st.decay[i]) {
        var left = st.decay[i] - st.t;
        score -= left < 300 ? 38 : left < CRACK_MS ? 22 : 8;   // cracking soon
      }

      // never step where I just came from (it cracks behind me)
      if (i === M.lastCell) score -= 26;

      // depth: "can I escape from there?" — bigger reachable region wins
      var depth = skill >= 8 ? 160 : skill >= 6 ? 90 : skill >= 4 ? 40 : skill >= 2 ? 12 : 0;
      if (depth > 0) {
        var sp = space(st, nx, ny, depth);
        score += Math.min(sp.room, depth) * 1.35;
        score += sp.risky * 0.3;
        if (sp.room < 3) score -= 70;                          // a closet: refuse at high skill
        else if (sp.room < 6) score -= 25 * (skill / 10);
      }

      // prefer the middle while the board is young, edges late (less traffic)
      var edge = Math.min(nx, ny, COLS - 1 - nx, ROWS - 1 - ny);
      score += (st.ph === 0 ? 6 : -2) * Math.min(edge, 3);

      candidates.push({ d: d, x: nx, y: ny, score: score + Math.random() * 6 });
    }

    if (!candidates.length) return { aim: { x: 0, y: 0 } };

    // blunder: low skill sometimes just hops without thinking
    if (Math.random() < AIC.blunder(skill) * 0.55) {
      var pick = candidates[(Math.random() * candidates.length) | 0];
      M.lastCell = cur;
      return { aim: { x: [0, 0, -1, 1][pick.d], y: [-1, 1, 0, 0][pick.d] } };
    }

    candidates.sort(function (a, b) { return b.score - a.score; });
    var best = candidates[0];
    M.lastCell = cur;
    return { aim: { x: [0, 0, -1, 1][best.d], y: [-1, 1, 0, 0][best.d] } };
  }

  return { think: think };
});
