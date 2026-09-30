// INFECTED AI — the sick commit to one victim and cut angles; the healthy
// fan out (each to their own escape lane) and play keep-away off the walls.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.infected = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var W = 800, H = 600;

  function snapshot(st, pid, inf) {
    var s = { inf: inf, foes: [], mates: [] };
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al || Number(k) === pid) continue;
      var rec = { pid: Number(k), x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, inf: !!o.inf };
      (rec.inf !== inf ? s.foes : s.mates).push(rec);
    }
    return s;
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var inf = !!p.inf;
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st, p.pid !== undefined ? p.pid : Number(p.slot), inf); });

    if (inf) {
      // hunt: sticky victim choice, fresh position every read, cut the angle.
      // equal top speeds means the tag only lands on a read or a corner trap,
      // so also herd: shade to the wall side and take the open lane away.
      var t = null;
      if (M.huntPid !== undefined) {
        for (var h = 0; h < S.foes.length; h++) if (S.foes[h].pid === M.huntPid) t = S.foes[h];
      }
      if (!t) {
        var bd = 1e9;
        for (var i = 0; i < S.foes.length; i++) {
          var f = S.foes[i];
          var d = Math.hypot(f.x - p.x, f.y - p.y);
          if (d < bd) { bd = d; t = f; }
        }
      }
      M.huntPid = t ? t.pid : undefined;
      if (!t) return { aim: { x: 0, y: 0 } };
      var d = Math.hypot(t.x - p.x, t.y - p.y);
      var lp = AIC.lead(p.x, p.y, t.x, t.y, t.vx, t.vy, 290);
      var cut = Math.min(1, (skill / 10) * (d < 150 ? 1.5 : 0.7));
      var ax0 = t.x + (lp.x - t.x) * cut - p.x, ay0 = t.y + (lp.y - t.y) * cut - p.y;
      // shade toward the wall behind the victim: squeeze it against an edge
      var wallX = t.x < 400 ? 0 : 800, wallY = t.y < 300 ? 0 : 600;
      var dWx = Math.abs(t.x - wallX), dWy = Math.abs(t.y - wallY);
      if (d > 60) {
        var herdBias = 0.38 * Math.min(1, skill / 7);
        if (dWx < 260) ax0 += (wallX - t.x) / (dWx || 1) * 60 * herdBias;
        if (dWy < 200) ay0 += (wallY - t.y) / (dWy || 1) * 60 * herdBias;
      }
      return { aim: AIC.wob(M, skill, AIC.norm(ax0, ay0), st.t) };
    }

    // healthy: run from every infected, spread from other healthy
    if (S.foes.length) {
      var esc = AIC.plan(M, skill, st.t, function () {
        var bdir = AIC.bestDir(p, function (dx, dy) {
          var s = 0;
          for (var i = 0; i < S.foes.length; i++) {
            var f = S.foes[i];
            s += Math.min(340, Math.hypot(f.x - (p.x + dx * 140), f.y - (p.y + dy * 140)));
          }
          if (S.foes.length === 1) s += Math.hypot(S.foes[0].x - p.x, S.foes[0].y - p.y) < 170 ? 0 : 0;
          var fx = p.x + dx * 190, fy = p.y + dy * 190;
          s -= Math.max(0, 60 - fx) * 1.5 + Math.max(0, fx - (W - 60)) * 1.5;
          s -= Math.max(0, 60 - fy) * 1.5 + Math.max(0, fy - (H - 60)) * 1.5;
          for (var m = 0; m < S.mates.length; m++) {
            var o = S.mates[m];
            var od = Math.hypot(o.x - (p.x + dx * 100), o.y - (p.y + dy * 100));
            if (od < 95) s -= (95 - od) * 0.55;
          }
          return s;
        }, 16);
        return { x: bdir.x, y: bdir.y };
      });
      // panic: low skill locks up and keeps a bad line when the sick get close
      var nearFoe = 1e9;
      for (var nf = 0; nf < S.foes.length; nf++) {
        var fd = Math.hypot(S.foes[nf].x - p.x, S.foes[nf].y - p.y);
        if (fd < nearFoe) nearFoe = fd;
      }
      if (nearFoe < 130 && Math.random() < AIC.blunder(skill) * 0.35) {
        return { aim: AIC.wob(M, 1, esc, st.t) };
      }
      return { aim: AIC.wob(M, skill, esc, st.t) };
    }
    return { aim: { x: 0, y: 0 } };
  }

  return { think: think };
});
