// REACTION ROYALE AI — literally the skill model: reaction time, nerve, and
// the discipline not to jump the gun on 'wait' rounds. Skill 10 posts pro
// times; skill 3 sometimes flinches.
(function (root, factory) {
  var api = factory((root.VP && root.VP.AIC) || require('../shared/aicore.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.VP = root.VP || {}; root.VP.AI = root.VP.AI || {}; root.VP.AI.reactionRoyale = api; }
})(typeof self !== 'undefined' ? self : globalThis, function (AIC) {
  'use strict';

  function think(st, p, skill) {
    var M = p.am || (p.am = {});
    if (st.done || p.out) return { k: 0 };
    if (st.phase !== 1) return { k: 0 };               // watch the prompt

    var ty = st.rounds[st.rn];
    var el = st.t - st.phT;

    // per-round nerve: when this round's trigger is set
    if (M.round !== st.rn) {
      M.round = st.rn;
      M.reactAt = AIC.reactMs(skill) * (0.85 + Math.random() * 0.5);
      M.dir = Math.random() < AIC.blunder(skill) * 0.5 ? -1 : (1 << st.tg);  // flub the match dir
      M.taps = 0;
    }

    if (ty === 'click') {
      // signal went up: fire after my reaction time
      if (el >= 300 && el >= M.reactAt + 300) return { tap: true };
      return { k: 0 };
    }
    if (ty === 'wait') {
      // no signal yet — clicking early is death. Nerve check.
      if (el < 300 + M.reactAt && Math.random() < AIC.blunder(skill) * 0.04) return { tap: true };
      return { k: 0 };
    }
    if (ty === 'match') {
      if (el >= 300 + M.reactAt && M.dir > 0) return { k: M.dir };
      return { k: 0 };
    }
    if (ty === 'spam') {
      // hammer it at a human cadence
      if (el > 200 && st.t - (M.lastTap || 0) > 110) { M.lastTap = st.t; return { tap: true }; }
      return { k: 0 };
    }
    return { k: 0 };
  }

  return { think: think };
});
