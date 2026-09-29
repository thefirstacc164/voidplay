(function (root) {
  'use strict';

  var ctx = null;
  var muted = false;

  try { muted = localStorage.getItem('vp.muted') === '1'; } catch (e) {}

  function ac() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, opt) {
    if (muted) return;
    var c = ac();
    if (!c) return;
    opt = opt || {};
    try {
      var t0 = c.currentTime;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = opt.type || 'square';
      o.frequency.setValueAtTime(freq, t0);
      if (opt.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.slide), t0 + dur);
      var vol = opt.vol || 0.06;
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (e) {}
  }

  function seq(notes, step, opt) {
    for (var i = 0; i < notes.length; i++) {
      (function (i) {
        setTimeout(function () { tone(notes[i], step / 1000 * 0.9, opt); }, i * step);
      })(i);
    }
  }

  var api = {
    click: function () { tone(760, 0.05, { vol: 0.04 }); },
    back: function () { tone(420, 0.06, { vol: 0.04 }); },
    start: function () { seq([330, 440, 550], 90, { type: 'square', vol: 0.05 }); },
    go: function () { tone(880, 0.18, { type: 'square', vol: 0.07, slide: 1320 }); },
    count: function () { tone(520, 0.08, { type: 'square', vol: 0.05 }); },
    win: function () { seq([523, 659, 784, 1047], 110, { type: 'square', vol: 0.06 }); },
    lose: function () { tone(300, 0.5, { type: 'sawtooth', vol: 0.05, slide: 90 }); },
    death: function () { tone(220, 0.22, { type: 'sawtooth', vol: 0.05, slide: 55 }); },
    coin: function () { tone(1180, 0.1, { type: 'sine', vol: 0.07, slide: 1660 }); },
    jump: function () { tone(320, 0.09, { type: 'square', vol: 0.035, slide: 620 }); },
    dash: function () { tone(500, 0.12, { type: 'sawtooth', vol: 0.04, slide: 900 }); },
    point: function () { tone(560, 0.1, { type: 'sine', vol: 0.06, slide: 940 }); },
    msg: function () { tone(640, 0.06, { type: 'sine', vol: 0.04 }); },
    trade: function () { seq([440, 660], 90, { type: 'sine', vol: 0.05 }); },
    join: function () { tone(440, 0.09, { type: 'sine', vol: 0.05, slide: 660 }); },
    toggle: function () {
      muted = !muted;
      try { localStorage.setItem('vp.muted', muted ? '1' : '0'); } catch (e) {}
      if (!muted) tone(700, 0.07, { vol: 0.05 });
      return muted;
    },
    muted: function () { return muted; },
    unlock: function () { ac(); },
  };

  root.VP = root.VP || {};
  root.VP.sound = api;
})(typeof self !== 'undefined' ? self : globalThis);
