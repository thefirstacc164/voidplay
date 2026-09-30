// JUGGERNAUT AI — the crown hunts with intercepts and dash reads; the
// challengers kite at distance, sidestep the dash, and dive to bump the
// crowned one off the edge when it drifts near the rim.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.juggernaut = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var CX = 400, CY = 300, R = 270;

  function snapshot(st, pid) {
    var s = { jg: st.jg, me: pid, others: [] };
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al || Number(k) === pid) continue;
      s.others.push({ pid: Number(k), x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, dcd: o.dcd || 0, dashT: o.dashT || 0 });
    }
    return s;
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var pid = p.pid !== undefined ? p.pid : Number(p.slot);
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st, pid); });
    var iAmJg = S.jg === pid;

    if (iAmJg) {
      // crowned: hunt the nearest with an intercept, commit to the chase
      var hunt = AIC.plan(M, skill, st.t, function () {
        var best = null, bd = 1e9;
        for (var i = 0; i < S.others.length; i++) {
          var o = S.others[i];
          var d = Math.hypot(o.x - p.x, o.y - p.y);
          if (d < bd) { bd = d; best = o; }
        }
        return { target: best };
      });
      if (!hunt.target) return { aim: { x: 0, y: 0 } };
      var t = hunt.target;
      var lp = AIC.lead(p.x, p.y, t.x, t.y, t.vx, t.vy, 300);
      var cut = Math.min(1, (skill / 10) * 1.3);
      var aimJ = AIC.norm(t.x + (lp.x - t.x) * cut - p.x, t.y + (lp.y - t.y) * cut - p.y);
      // read the rim: past this radius a missed bump means falling out — brake
      var myRJ = Math.hypot(p.x - CX, p.y - CY);
      if (skill >= 4 && myRJ > R - 72) {
        var coast = (Math.hypot(p.vx || 0, p.vy || 0) || 0) / 3.2;   // friction 3.2
        if (myRJ + coast > R - 14) {
          var inJ = AIC.norm(CX - p.x, CY - p.y);
          aimJ = AIC.norm(aimJ.x + inJ.x * 1.6, aimJ.y + inJ.y * 1.6);
        }
      }
      return { aim: AIC.wob(M, skill, aimJ, st.t) };
    }

    // challenger
    var jg = S.others.filter(function (o) { return o.pid === S.jg; })[0];
    if (!jg) return { aim: AIC.seek(p, CX, CY, 800, 600, 60) };

    var jgRim = Math.hypot(jg.x - CX, jg.y - CY);
    var myDJg = Math.hypot(jg.x - p.x, jg.y - p.y);
    var canBump = (p.dcd || 0) <= 0;

    // baiter = the challenger the crown is hunting (closest to it); the rest
    // are divers waiting mid-ring to shove the crown out of the outer band
    var iAmBait = true;
    for (var ci = 0; ci < S.others.length; ci++) {
      var oth = S.others[ci];
      if (oth.pid === S.jg) continue;
      if (Math.hypot(oth.x - jg.x, oth.y - jg.y) < myDJg - 30) { iAmBait = false; break; }
    }

    // DIVE: deep enough that a dash ejects (mass-3 crown needs ~r>205 from a
    // 500-power hit) — or the crown just burned its dash near the rim
    var diveReady = canBump && skill >= 3 && !iAmBait &&
      ((jgRim > R - 62) || ((jg.dcd || 0) > 400 && jgRim > R - 95));
    if (diveReady) {
      var outDir = AIC.norm(jg.x - CX, jg.y - CY);
      var strikeFrom = { x: jg.x - outDir.x * 40, y: jg.y - outDir.y * 40 };
      var dJg = Math.hypot(strikeFrom.x - p.x, strikeFrom.y - p.y);
      var tap = dJg < 105 && Math.random() < 0.55;
      var aim = AIC.norm(strikeFrom.x + outDir.x * 60 - p.x, strikeFrom.y + outDir.y * 60 - p.y);
      return { aim: AIC.wob(M, skill, aim, st.t), tap: tap };
    }

    var esc;
    if (iAmBait) {
      // lure: circle the outer band so the crown follows me toward the rim,
      // and cross its line instead of fleeing straight away
      esc = AIC.plan(M, skill, st.t, function () {
        var bdir = AIC.bestDir(p, function (dx, dy) {
          var rr = Math.hypot(p.x + dx * 200 - CX, p.y + dy * 200 - CY);
          var s = -Math.abs(rr - (R - 38)) * 1.6;            // stay on the bait ring
          var pv = Math.abs(dx * (jg.vx || 0) + dy * (jg.vy || 0));
          s -= pv * 1.0;                                     // cut across its charge
          var closeB = Math.hypot(jg.x - (p.x + dx * 90), jg.y - (p.y + dy * 90));
          s -= closeB * 0.25 - Math.max(0, 120 - closeB) * 1.4;   // never inside its bump range
          return s;
        }, 16);
        return { x: bdir.x, y: bdir.y };
      });
    } else {
      // waiting diver: hold mid-ring, keep the crown at striking distance
      esc = AIC.plan(M, skill, st.t, function () {
        var bdir = AIC.bestDir(p, function (dx, dy) {
          var rr = Math.hypot(p.x + dx * 200 - CX, p.y + dy * 200 - CY);
          var dJ = Math.hypot(jg.x - (p.x + dx * 150), jg.y - (p.y + dy * 150));
          return -Math.abs(rr - (R - 130)) * 0.9 - Math.abs(dJ - 150) * 0.5;
        }, 16);
        return { x: bdir.x, y: bdir.y };
      });
    }
    return { aim: AIC.wob(M, skill, esc, st.t) };
  }

  return { think: think };
});
