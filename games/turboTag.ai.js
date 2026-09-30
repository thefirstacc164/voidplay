// TURBO TAG AI — like bomb tag with a turbo: commits to intercepts, spends
// the boost to close a gap or escape a pin, and never tags into immunity.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.turboTag = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var W = 800, H = 600;

  function snapshot(st, pid) {
    var s = { it: st.it, imm: st.imm, me: null, others: [] };
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al) continue;
      var rec = { pid: Number(k), x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, dcd: o.dcd || 0 };
      if (Number(k) === pid) s.me = rec;
      else s.others.push(rec);
    }
    return s;
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st, p.pid !== undefined ? p.pid : Number(p.slot)); });
    var iAmIt = S.me && S.me.pid === S.it;

    if (iAmIt) {
      // sticky target choice, but always read its CURRENT position (a chase
      // that aims at where the runner was a second ago swings at ghosts)
      var cands = S.others.slice().sort(function (a, b) {
        return Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y);
      });
      var t = null;
      if (M.huntPid !== undefined) {
        for (var h = 0; h < cands.length; h++) if (cands[h].pid === M.huntPid) t = cands[h];
      }
      if (!t || (S.imm > 0 && Math.hypot(t.x - p.x, t.y - p.y) < 150)) {
        t = cands[0] || null;
        // during immunity, line up the next victim so we arrive as it fades
        if (S.imm > 0 && cands.length > 1 && t && Math.hypot(t.x - p.x, t.y - p.y) < 150) {
          for (var c = 0; c < cands.length; c++) {
            if (Math.hypot(cands[c].x - p.x, cands[c].y - p.y) > 200) t = cands[c];
          }
        }
      }
      // switch targets only for a clearly better victim
      if (t && cands[0] && cands[0] !== t &&
          Math.hypot(cands[0].x - p.x, cands[0].y - p.y) < Math.hypot(t.x - p.x, t.y - p.y) * 0.55) t = cands[0];
      M.huntPid = t ? t.pid : undefined;
      if (!t) return { aim: { x: 0, y: 0 } };

      var d = Math.hypot(t.x - p.x, t.y - p.y);
      var lp = AIC.lead(p.x, p.y, t.x, t.y, t.vx, t.vy, 300);
      var cut = Math.min(1, (skill / 10) * (d < 160 ? 1.4 : 0.7));
      var aim = AIC.norm(t.x + (lp.x - t.x) * cut - p.x, t.y + (lp.y - t.y) * cut - p.y);
      // spend the turbo to close a real gap (not while immune)
      var tap = skill >= 4 && S.imm <= 0 && d > 130 && d < 300 && (p.dcd || 0) <= 0 && Math.random() < 0.06;
      return { aim: AIC.wob(M, skill, aim, st.t), tap: tap };
    }

    // runner
    if (S.it !== undefined) {
      var it = S.others.filter(function (o) { return o.pid === S.it; })[0];
      if (it) {
        var esc = AIC.plan(M, skill, st.t, function () {
          var bdir = AIC.bestDir(p, function (dx, dy) {
            var s = Math.hypot(it.x - (p.x + dx * 140), it.y - (p.y + dy * 140)) * 1.3;
            var fx = p.x + dx * 190, fy = p.y + dy * 190;
            s -= Math.max(0, 55 - fx) * 1.4 + Math.max(0, fx - (W - 55)) * 1.4;
            s -= Math.max(0, 55 - fy) * 1.4 + Math.max(0, fy - (H - 55)) * 1.4;
            for (var i = 0; i < S.others.length; i++) {
              var o = S.others[i];
              if (o.pid === S.it) continue;
              var od = Math.hypot(o.x - (p.x + dx * 90), o.y - (p.y + dy * 90));
              if (od < 85) s -= (85 - od) * 0.5;
            }
            return s;
          }, 16);
          return { x: bdir.x, y: bdir.y };
        });
        var dIt = Math.hypot(it.x - p.x, it.y - p.y);
        var cornered = (p.x < 70 || p.x > W - 70 || p.y < 70 || p.y > H - 70);
        var tap = skill >= 5 && dIt < 120 && cornered && (p.dcd || 0) <= 0 && Math.random() < 0.2;
        return { aim: AIC.wob(M, skill, esc, st.t), tap: tap };
      }
    }
    return { aim: { x: 0, y: 0 } };
  }

  return { think: think };
});
