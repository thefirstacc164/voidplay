// BOMB TAG AI — chases with commitment and cut angles, flees with a plan.
// The holder picks a victim and runs an intercept, not a homing beacon.
// Runners commit to escape lines, keep off the walls, and don't huddle.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.bombTag = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var CX = 400, CY = 300, R = 265, SPEED = 280;

  function snapshot(st, pid) {
    var s = { holder: null, me: null, others: [] };
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al) continue;
      var rec = { pid: Number(k), x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0 };
      if (Number(k) === pid) s.me = rec;
      else s.others.push(rec);
      if (Number(k) === st.bomb) s.holder = rec;
    }
    return s;
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st, p.pid !== undefined ? p.pid : Number(p.slot)); });

    // ---- I hold the bomb: hunt ----
    if (S.holder && S.me && S.holder.pid === S.me.pid) {
      var hunt = AIC.plan(M, skill, st.t, function () {
        // choose the victim: nearest, but a pro reads who's cornered
        var best = null, bestScore = -1e9;
        for (var i = 0; i < S.others.length; i++) {
          var o = S.others[i];
          var d = Math.hypot(o.x - p.x, o.y - p.y);
          var edge = R - Math.hypot(o.x - CX, o.y - CY);   // closer to wall = cornered
          var score = -d + (skill >= 6 ? Math.max(0, 120 - edge) * 0.8 : 0);
          if (score > bestScore) { bestScore = score; best = o; }
        }
        return { target: best };
      });
      if (!hunt.target) return { aim: AIC.seek(p, CX, CY, 800, 600, 80) };

      // intercept: aim where they WILL be, harder cut when close (skill)
      var tdist = Math.hypot(hunt.target.x - p.x, hunt.target.y - p.y);
      var leadT = AIC.lead(p.x, p.y, hunt.target.x, hunt.target.y, hunt.target.vx, hunt.target.vy, SPEED);
      var cut = Math.min(1, (skill / 10) * (tdist < 150 ? 1.5 : 0.8));
      var aimAt = {
        x: hunt.target.x + (leadT.x - hunt.target.x) * cut,
        y: hunt.target.y + (leadT.y - hunt.target.y) * cut,
      };
      var dx = aimAt.x - p.x, dy = aimAt.y - p.y;
      var l = Math.hypot(dx, dy) || 1;
      return { aim: AIC.wob(M, skill, { x: dx / l, y: dy / l }, st.t) };
    }

    // ---- runner: get away from the holder, don't get pinned ----
    if (S.holder) {
      var esc = AIC.plan(M, skill, st.t, function () {
        var threats = [S.holder];
        // score 16 directions: room from the holder, off the arena wall,
        // and away from other runners (spread out, no huddle)
        var bdir = AIC.bestDir(p, function (dx, dy) {
          var s = Math.min(360, Math.hypot(S.holder.x - (p.x + dx * 140), S.holder.y - (p.y + dy * 140))) * 1.2;
          var cx = p.x + dx * 200 - CX, cy = p.y + dy * 200 - CY;
          var r2 = Math.hypot(cx, cy);
          s -= Math.max(0, r2 - (R - 75)) * 1.6;           // pinched against the rim
          for (var i = 0; i < S.others.length; i++) {
            var o = S.others[i];
            if (o.pid === S.holder.pid) continue;
            var od = Math.hypot(o.x - (p.x + dx * 90), o.y - (p.y + dy * 90));
            if (od < 80) s -= (80 - od) * 0.5;             // personal space
          }
          return s;
        }, 16);
        return { x: bdir.x, y: bdir.y };
      });
      // wall recovery overrides commitment when actually pinned
      var rr = Math.hypot(p.x - CX, p.y - CY);
      if (rr > R - 42) {
        var inward = AIC.norm(CX - p.x, CY - p.y);
        var blended = AIC.norm(esc.x + inward.x * 1.4, esc.y + inward.y * 1.4);
        return { aim: blended };
      }
      return { aim: AIC.wob(M, skill, esc, st.t) };
    }

    return { aim: AIC.seek(p, CX, CY, 800, 600, 80) };
  }

  return { think: think };
});
