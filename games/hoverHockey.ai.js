// HOVER HOCKEY AI — positions, passes, angles. No more puck-glue.
// Roles: a defender holds the slot and clears with the body, attackers space
// out, call for passes, carry around pressure and shoot corners. Everyone
// plays on a reaction delay with a wobbly stick.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.hoverHockey = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  var W = 800, H = 600;
  var G_TOP = 235, G_BOT = 365, GCY = 300;
  var SPEED = 380;

  function goalX(team) { return team === 0 ? 0 : W; }       // goal I defend
  function attackX(team) { return team === 0 ? W : 0; }     // goal I score on

  // snapshot: puck + everyone, frozen for reactMs — fast pucks skate past
  // slow eyes, exactly like a human keeper getting beaten one-timed.
  function snapshot(st, p) {
    var s = { puck: null, mates: [], foes: [], freeze: st.freeze };
    if (st.puck) s.puck = { x: st.puck.x, y: st.puck.y, vx: st.puck.vx, vy: st.puck.vy };
    for (var k in st.p) {
      var o = st.p[k];
      if (!o.al) continue;
      (o.team === p.team ? s.mates : s.foes).push({ x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, pid: Number(k) });
    }
    return s;
  }

  function inField(x, y) { return x > 24 && x < W - 24 && y > 24 && y < H - 24; }

  // is the straight line a->b crowded by foes within `r`?
  function laneOpen(a, b, foes, r) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var l = Math.hypot(dx, dy) || 1;
    for (var i = 0; i < foes.length; i++) {
      var f = foes[i];
      var t = ((f.x - a.x) * dx + (f.y - a.y) * dy) / (l * l);
      if (t < -0.05 || t > 1.05) continue;
      var px = a.x + dx * t, py = a.y + dy * t;
      if (Math.hypot(f.x - px, f.y - py) < r) return false;
    }
    return true;
  }

  function nearest(list, x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < list.length; i++) {
      var d = Math.hypot(list[i].x - x, list[i].y - y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return { o: best, d: bd };
  }

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    var S = AIC.see(M, skill, st.t, function () { return snapshot(st, p); });
    if (!S.puck) return { aim: AIC.seek(p, W / 2, GCY, W, H, 60) };

    var me = { x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0 };
    var team = p.team !== undefined ? p.team : (p.slot - 1) % 2;
    var myGoal = { x: goalX(team), y: GCY };
    var foeGoal = { x: attackX(team), y: GCY };

    // pick the defender: closest to our own goal, with hysteresis so the
    // role doesn't flip mid-play (a 15% bias keeps assignments stable)
    var myD = Math.hypot(p.x - (myGoal.x === 0 ? 0 : W), p.y - GCY);
    var mateD = 1e9;
    for (var mi0 = 0; mi0 < S.mates.length; mi0++) {
      var mm = S.mates[mi0];
      var md0 = Math.hypot(mm.x - (myGoal.x === 0 ? 0 : W), mm.y - GCY);
      if (md0 < mateD) mateD = md0;
    }
    // role split: clearly closest defends; in a near-tie the strictly closer
    // one does. Both teammates compute the same answer, so no double-D, no gap.
    var ratio = myD / (mateD || 1e9);
    var iDefend;
    if (ratio < 0.92) iDefend = true;
    else if (ratio > 1.09) iDefend = false;
    else iDefend = myD <= mateD;

    // where the puck is going (from the frozen snapshot)
    var puckLead = AIC.lead(me.x, me.y, S.puck.x, S.puck.y, S.puck.vx, S.puck.vy, SPEED * 0.9);
    var puckDist = Math.hypot(S.puck.x - me.x, S.puck.y - me.y);

    // ============ DEFENDER ============
    if (iDefend) {
      var homeX = myGoal.x === 0 ? 92 : W - 92;
      var pressRange = skill >= 7 ? 210 : skill >= 4 ? 170 : 140;
      var threat = Math.abs(S.puck.x - myGoal.x) < pressRange && (myGoal.x === 0 ? S.puck.vx < 260 : S.puck.vx > -260);

      if (threat || puckDist < 130) {
        // press from the goal side so any contact clears it up-field
        var press = AIC.norm(S.puck.x - myGoal.x, S.puck.y - GCY);
        var bx = AIC.clamp(S.puck.x - press.x * 30, 18, W - 18);
        var by = AIC.clamp(S.puck.y - press.y * 30, 18, H - 18);
        return { aim: AIC.wob(M, skill, AIC.seek(p, bx, by, W, H, 40), st.t) };
      }
      // hold the slot, mirror the puck's y
      var holdY = AIC.clamp(300 + (S.puck.y - 300) * 0.55, 258, 342);
      return { aim: AIC.wob(M, skill, AIC.seek(p, homeX, holdY, W, H, 40), st.t) };
    }

    // ============ ATTACKER ============
    var iHavePuck = puckDist < 64;
    var iChase = true;
    for (var mi = 0; mi < S.mates.length; mi++) {
      var m = S.mates[mi];
      if (Math.hypot(S.puck.x - m.x, S.puck.y - m.y) < puckDist) { iChase = false; break; }
    }

    if (iHavePuck) {
      var pressure = nearest(S.foes, me.x, me.y);
      var pressured = pressure.d < 95;
      var goalDist = Math.hypot(foeGoal.x - me.x, foeGoal.y - me.y);
      var shotFrom = skill >= 7 ? 340 : 270;

      // shoot: inside range with a lane to the mouth
      if (goalDist < shotFrom) {
        var mouthY = me.y > GCY ? G_TOP + 22 : G_BOT - 22;      // far corner
        var shotAt = { x: foeGoal.x + (foeGoal.x === 0 ? -14 : 14), y: mouthY };
        if (laneOpen(me, shotAt, S.foes, 34 + (10 - skill) * 3)) {
          return { aim: AIC.wob(M, skill, AIC.norm(shotAt.x - S.puck.x, shotAt.y - S.puck.y), st.t) };
        }
      }

      // pass: pressured, or a mate is clearly better placed, and the lane is clean
      var hardPressured = pressure.d < 70;
      if (S.mates.length && (hardPressured || goalDist > 420)) {
        var bestMate = null, bestVal = -1e9;
        for (var pi = 0; pi < S.mates.length; pi++) {
          var mt = S.mates[pi];
          var md = Math.hypot(mt.x - me.x, mt.y - me.y);
          if (md < 150 || md > 430) continue;
          var val = 400 - Math.hypot(foeGoal.x - mt.x, foeGoal.y - mt.y) * 0.6 - md * 0.15;
          var mat = nearest(S.foes, mt.x, mt.y);
          val += Math.min(mat.d, 200) * 0.4;
          if (val > bestVal) { bestVal = val; bestMate = mt; }
        }
        if (bestMate) {
          var lead = AIC.lead(me.x, me.y, bestMate.x, bestMate.y, bestMate.vx, bestMate.vy, SPEED);
          var passTo = { x: AIC.clamp(lead.x, 20, W - 20), y: AIC.clamp(lead.y, 20, H - 20) };
          if (laneOpen(me, passTo, S.foes, 30) && (pressured || bestVal > 400 - goalDist * 0.6 + 40)) {
            return { aim: AIC.wob(M, skill, AIC.norm(passTo.x - S.puck.x, passTo.y - S.puck.y), st.t) };
          }
        }
      }

      // carry: drive at the goal, swing around whoever's in the way
      var carry = AIC.norm(foeGoal.x - me.x, foeGoal.y - me.y);
      var blocker = null, bd = 1e9;
      for (var fi = 0; fi < S.foes.length; fi++) {
        var f = S.foes[fi];
        var ahead = (f.x - me.x) * carry.x + (f.y - me.y) * carry.y;
        if (ahead > 0 && ahead < 170) {
          var side = Math.hypot(f.x - me.x, f.y - me.y);
          if (side < bd) { bd = side; blocker = f; }
        }
      }
      if (blocker && bd < 120) {
        var swing = blocker.y > GCY ? -1 : 1;
        carry = AIC.norm(carry.x * 0.5, carry.y + swing * 1.1);
      }
      return { aim: AIC.wob(M, skill, carry, st.t) };
    }

    if (iChase) {
      // hunt the intercept point; line up BEHIND the puck relative to the
      // enemy net so every contact pushes it their way, never into mine
      var ix = AIC.clamp(puckLead.x, 16, W - 16), iy = AIC.clamp(puckLead.y, 16, H - 16);
      var toward = AIC.norm(foeGoal.x - ix, GCY - iy);
      var standoff = 34;
      var spotX = AIC.clamp(ix - toward.x * standoff, 14, W - 14);
      var spotY = AIC.clamp(iy - toward.y * standoff, 14, H - 14);
      // far away: run at the spot; close: drive through the puck
      var dToPuck = Math.hypot(S.puck.x - me.x, S.puck.y - me.y);
      if (dToPuck < 90) spotX = ix + toward.x * 10, spotY = iy + toward.y * 10;
      return { aim: AIC.wob(M, skill, AIC.seek(p, spotX, spotY, W, H, 24), st.t) };
    }

    // get open: sit on the puck->goal line, offset to the quiet side
    var gx = foeGoal.x, gy = GCY;
    var dxl = gx - S.puck.x, dyl = gy - S.puck.y;
    var ll = Math.hypot(dxl, dyl) || 1;
    var nx = -dyl / ll, ny = dxl / ll;
    var t = 0.55;
    var open = { x: S.puck.x + dxl * t, y: S.puck.y + dyl * t };
    var side = 1;
    var foesNearA = 0, foesNearB = 0;
    var spotA = { x: open.x + nx * 130, y: open.y + ny * 130 };
    var spotB = { x: open.x - nx * 130, y: open.y - ny * 130 };
    for (var fj = 0; fj < S.foes.length; fj++) {
      if (Math.hypot(S.foes[fj].x - spotA.x, S.foes[fj].y - spotA.y) < 110) foesNearA++;
      if (Math.hypot(S.foes[fj].x - spotB.x, S.foes[fj].y - spotB.y) < 110) foesNearB++;
    }
    side = foesNearA <= foesNearB ? 1 : -1;
    var spot = { x: AIC.clamp(open.x + nx * 130 * side, 40, W - 40), y: AIC.clamp(open.y + ny * 130 * side, 40, H - 40) };
    if (!inField(spot.x, spot.y)) spot = { x: AIC.clamp(open.x, 40, W - 40), y: AIC.clamp(open.y, 40, H - 40) };
    return { aim: AIC.wob(M, skill, AIC.seek(p, spot.x, spot.y, W, H, 50), st.t) };
  }

  return { think: think };
});
