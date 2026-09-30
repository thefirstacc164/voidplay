(function () {
  'use strict';
  if (window.VPX) { try { window.VPX.panel(true); } catch (e) {} return; }

  var S = window.VP && window.VP.S;
  var ENG = window.VP && window.VP.engine;
  var E = ENG && ENG.E;
  if (!E) return;
  if (!window.VP_GAMES) window.VP_GAMES = {};

  var ADMK = '';
  try { ADMK = window.VPXK || ''; delete window.VPXK; } catch (eAdm) { ADMK = ''; }

  var OPS = { open: false, god: false, freeze: false, turbo: false, auto: false, forceWin: false, act: {}, aids: {}, srv: { god: false, turbo: false, auto: false, freeze: false, act: {} } };

  function isRemote() { return E.mode === 'remote'; }

  function setGod(v) {
    v = !!v;
    if (isRemote()) { OPS.srv.god = v; srvSend({ god: v }); }
    else OPS.god = v;
    return v;
  }
  function setFreeze(v) {
    v = !!v;
    if (isRemote()) { OPS.srv.freeze = v; srvSend({ freeze: v }); }
    else OPS.freeze = v;
    return v;
  }
  function setAuto(v) {
    v = !!v;
    if (isRemote()) { OPS.srv.auto = v; srvSend({ auto: v }); }
    else OPS.auto = v;
    return v;
  }
  function setTurbo(v) {
    v = !!v;
    if (isRemote()) { OPS.srv.turbo = v; srvSend({ turbo: v }); }
    else OPS.turbo = v;
    return v;
  }
  function setAct(id, v) {
    v = !!v;
    if (isRemote()) { OPS.srv.act[id] = v; var a = {}; a[id] = v; srvSend(null, a); }
    else OPS.act[id] = v;
    return v;
  }
  function instantWin() {
    if (isRemote()) srvSend(null, null, true);
    else OPS.forceWin = true;
  }
  function toggleAllOn() {
    if (isRemote()) {
      OPS.srv.god = true;
      OPS.srv.turbo = true;
      OPS.srv.auto = true;
      var rgid = E.gameId;
      var ract = {};
      if (rgid && GAME_ASSISTS[rgid]) {
        for (var j = 0; j < GAME_ASSISTS[rgid].length; j++) { ract[GAME_ASSISTS[rgid][j].id] = true; OPS.srv.act[GAME_ASSISTS[rgid][j].id] = true; }
      }
      srvSend({ god: true, turbo: true, auto: true }, ract);
      return;
    }
    OPS.god = true;
    OPS.turbo = true;
    OPS.auto = true;
    var gid = E.gameId;
    if (gid && GAME_ASSISTS[gid]) {
      for (var i = 0; i < GAME_ASSISTS[gid].length; i++) OPS.act[GAME_ASSISTS[gid][i].id] = true;
      OPS.aids[gid] = true;
    }
  }

  function srvSend(patch, act, win) {
    if (!ADMK) return;
    var n = window.VP && window.VP.net;
    if (!n || !n.send) return;
    var msg = { e: 'ops', k: ADMK };
    if (patch) msg.o = patch;
    if (act) msg.act = act;
    if (win) msg.win = 1;
    n.send(4, msg);
  }

  function bindSrvAcks() {
    var n = window.VP && window.VP.net;
    if (!n || !n.on) return;
    n.on(4, function (msg) {
      if (!msg || msg.e !== 'opsack' || !msg.st) return;
      OPS.srv.god = !!msg.st.god;
      OPS.srv.turbo = !!msg.st.turbo;
      OPS.srv.auto = !!msg.st.auto;
      OPS.srv.freeze = !!msg.st.freeze;
      var ackAct = msg.st.act || {};
      for (var ak in ackAct) OPS.srv.act[ak] = !!ackAct[ak];
      refreshToggles();
    });
  }
  var frame = 0;
  var lastPos = {};
  var rrRound = -1;
  var rrPulse = 0;

  function myIds() {
    if (E.mode !== 'local') return [];
    return E.twoP ? [1, 2] : [1];
  }

  function keyDir(k) {
    var x = 0, y = 0;
    if (k & 1) y -= 1;
    if (k & 2) y += 1;
    if (k & 4) x -= 1;
    if (k & 8) x += 1;
    var l = Math.hypot(x, y);
    return l ? { x: x / l, y: y / l } : null;
  }

  function predictPuckY(pk, goalX) {
    var x = pk.x, y = pk.y, vx = pk.vx, vy = pk.vy;
    for (var i = 0; i < 240; i++) {
      x += vx * 0.016;
      y += vy * 0.016;
      if (y < 14) { y = 14; vy = Math.abs(vy); }
      if (y > 586) { y = 586; vy = -Math.abs(vy); }
      if (vx < 0 && x <= goalX) return y;
      if (vx > 0 && x >= goalX) return y;
      vx *= 0.996;
      if (Math.abs(vx) < 40) return null;
    }
    return null;
  }

  function eachOf(st, ids, fn) {
    for (var i = 0; i < ids.length; i++) {
      var p = st.p[String(ids[i])];
      if (p && p.al) fn(p, ids[i]);
    }
  }

  function nearestOther(st, ids, p) {
    var best = null, bd = 1e9;
    for (var q in st.p) {
      var o = st.p[q];
      if (!o.al || ids.indexOf(Number(q)) >= 0) continue;
      var d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = Number(q); }
    }
    return best;
  }

  var GAME_ASSISTS = {

    asteroidStorm: [
      { id: 'as-dodge', label: 'auto dodge', d: 'auto-steer away from meteors', run: function (st) {
        eachOf(st, myIds(), function (p) {
          for (var q = 0; q < 3; q++) {
            var best = null, bd = 1e9;
            for (var k in st.en) {
              var e = st.en[k];
              var d = Math.hypot(e.x - p.x, e.y - p.y) - e.r;
              if (d < 150 && d < bd) { bd = d; best = e; }
            }
            if (!best) return;
            var dx = p.x - best.x, dy = p.y - best.y;
            var l = Math.hypot(dx, dy) || 1;
            p.x += (dx / l) * 6;
            p.y += (dy / l) * 6;
          }
        });
      } },
      { id: 'as-shield', label: 'meteor shield', d: 'meteors bounce off you', run: function (st) {
        var ids = myIds();
        eachOf(st, ids, function (p) {
          for (var k in st.en) {
            var e = st.en[k];
            if (!e.w && Math.hypot(p.x - e.x, p.y - e.y) < 85) delete st.en[k];
          }
        });
      } }
    ],

    bombTag: [
      { id: 'bt-pass', label: 'hot potato', d: 'shoves the bomb to the nearest player', run: function (st) {
        var ids = myIds();
        eachOf(st, ids, function (p, id) {
          if (st.bomb !== id) return;
          var o = nearestOther(st, ids, p);
          if (o !== null) { st.bomb = o; if (st.passCd !== undefined) st.passCd = 500; }
        });
      } },
      { id: 'bt-fuse', label: 'cool fuse', d: 'the fuse burns slower', run: function (st) {
        if (st.fuse < 6500) st.fuse = 6500;
      } }
    ],

    bumperKnock: [
      { id: 'bk-bump', label: 'super bump', d: 'you knock everyone flying', run: function (st) {
        eachOf(st, myIds(), function (p) { p.dashT = 500; });
      } }
    ],

    colorRaid: [
      { id: 'cr-brush', label: 'mega brush', d: 'huge painting radius', run: function (st) {
        eachOf(st, myIds(), function (p) {
          var gx = Math.round((p.x - 32) / 46), gy = Math.round((p.y - 60) / 40);
          for (var dy = -8; dy <= 8; dy++) for (var dx = -8; dx <= 8; dx++) {
            if (dx * dx + dy * dy > 45) continue;
            var x = gx + dx, y = gy + dy;
            if (x < 0 || y < 0 || x > 15 || y > 11) continue;
            st.tiles[y * 16 + x] = p.pid;
          }
        });
      } }
    ],

    gravityWell: [
      { id: 'gw-magnet', label: 'coin magnet', d: 'coins fly to you', run: function (st, dts) {
        eachOf(st, myIds(), function (p) {
          for (var k in st.en) {
            var e = st.en[k];
            var dx = p.x - e.x, dy = p.y - e.y;
            var l = Math.hypot(dx, dy) || 1;
            if (l < 240) { e.x += (dx / l) * 340 * dts; e.y += (dy / l) * 340 * dts; }
          }
        });
      } },
      { id: 'gw-repel', label: 'core repel', d: 'the core pushes you away', run: function (st, dts) {
        eachOf(st, myIds(), function (p) {
          var dx = p.x - 400, dy = p.y - 300;
          var r = Math.hypot(dx, dy) || 1;
          if (r < 175) { p.vx += dx / r * 1600 * dts; p.vy += dy / r * 1600 * dts; }
          for (var k in st.en) {
            var e = st.en[k];
            if (Math.hypot(p.x - e.x, p.y - e.y) < 75) delete st.en[k];
          }
        });
      } }
    ],

    hoverHockey: [
      { id: 'hh-keeper', label: 'perfect keeper', d: '100% saves with shot prediction', run: function (st) {
        if (!st.puck) return;
        var pk = st.puck;
        eachOf(st, myIds(), function (p) {
          var team = p.team !== undefined ? p.team : (p.slot - 1) % 2;
          var left = team === 0;
          var line = left ? 40 : 760;
          var cross = predictPuckY(pk, left ? 20 : 780);
          var ty;
          if (cross !== null && cross > 232 && cross < 368) ty = Math.max(239, Math.min(361, cross));
          else ty = Math.max(250, Math.min(350, pk.y));
          if (left ? pk.x < 36 : pk.x > 764) {
            p.x = Math.max(20, Math.min(780, left ? pk.x - 18 : pk.x + 18));
            p.y = Math.max(232, Math.min(368, pk.y));
          } else {
            p.x = line;
            p.y = ty;
          }
          p.vx = 0; p.vy = 0;
        });
      } },
      { id: 'hh-shot', label: 'power shot', d: 'slam the puck at their goal', run: function (st) {
        var pk = st.puck;
        if (!pk) return;
        eachOf(st, myIds(), function (p, id) {
          var d = Math.hypot(pk.x - p.x, pk.y - p.y);
          if (d > 120) return;
          var team = (p.slot - 1) % 2;
          var tx = team === 0 ? 860 : -60;
          var dx = tx - pk.x, dy = 300 - pk.y;
          var l = Math.hypot(dx, dy) || 1;
          pk.vx = (dx / l) * 560;
          pk.vy = (dy / l) * 560;
        });
      } },
      { id: 'hh-magnet', label: 'puck magnet', d: 'the puck sticks near you', run: function (st, dts) {
        var p = st.p['1'];
        if (!p || !p.al || !st.puck) return;
        var gx = p.team === 0 ? 830 : -30;
        var dx = gx - st.puck.x, dy = 300 - st.puck.y;
        var l = Math.hypot(dx, dy) || 1;
        var near = Math.hypot(p.x - st.puck.x, p.y - st.puck.y) < 220;
        var push = (near ? 1500 : 420) * dts;
        st.puck.vx += dx / l * push;
        st.puck.vy += dy / l * push * 0.6;
      } }
    ],

    infected: [
      { id: 'in-immune', label: 'immune', d: 'you can never be infected', run: function (st) {
        var ids = myIds();
        eachOf(st, ids, function (p, id) {
          if (st.inf !== id) return;
          var o = nearestOther(st, ids, p);
          if (o !== null) st.inf = o;
        });
      } }
    ],

    juggernaut: [
      { id: 'jg-always', label: 'always juggernaut', d: 'you are always the juggernaut', run: function (st) {
        var p = st.p['1'];
        if (p && p.al) st.jg = 1;
      } }
    ],

    kingOfTheHill: [
      { id: 'kh-warp', label: 'hill warp', d: 'teleport onto the hill', run: function (st) {
        eachOf(st, myIds(), function (p, id) {
          if (id === 1) { p.x = 408; p.y = 300; }
          else { p.x = 392; p.y = 300; }
          p.vx = 0; p.vy = 0;
        });
      } },
      { id: 'kh-score', label: 'triple score', d: 'x3 points while on the hill', run: function (st, dts) {
        eachOf(st, myIds(), function (p) { p.sc += 2 * dts; });
      } }
    ],

    laserMaze: [
      { id: 'lm-calm', label: 'serenity', d: 'drifts you to the safe center', run: function (st) {
        var p = st.p['1'];
        if (!p || !p.al) return;
        p.x += (400 - p.x) * 0.02;
        p.y += (300 - p.y) * 0.02;
      } }
    ],

    lavaFloor: [
      { id: 'lv-moon', label: 'moon jump', d: 'jump nonstop, even midair', run: function (st, dts, f) {
        if (f % 4 < 2) { E.keys1 |= 16; if (E.twoP) E.keys2 |= 16; }
        else { E.keys1 &= ~16; if (E.twoP) E.keys2 &= ~16; }
      } },
      { id: 'lv-hover', label: 'hover', d: 'float gently upward forever', run: function (st, dts) {
        eachOf(st, myIds(), function (p) {
          p.y -= 130 * dts;
          if (p.vy > 0) p.vy = 0;
        });
      } }
    ],

    mazeRacer: [
      { id: 'mr-steer', label: 'auto steer', d: 'auto-drives you to the finish', run: function (st, dts) {
        var p = st.p['1'];
        if (!p || !p.al || !st._dist) return;
        var c = Math.max(0, Math.min(24, (p.x / 32) | 0));
        var r = Math.max(0, Math.min(17, (p.y / 32) | 0));
        var best = null, bd = st._dist[r * 25 + c];
        var NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (var i = 0; i < 4; i++) {
          var nc = c + NB[i][0], nr = r + NB[i][1];
          if (nc < 0 || nr < 0 || nc > 24 || nr > 17) continue;
          var nd = st._dist[nr * 25 + nc];
          if (nd >= 0 && nd < bd) { bd = nd; best = NB[i]; }
        }
        if (best) {
          var tx = (c + best[0] + 0.5) * 32, ty = (r + best[1] + 0.5) * 32;
          var dx = tx - p.x, dy = ty - p.y;
          var l = Math.hypot(dx, dy) || 1;
          p.x += dx / l * Math.min(160 * dts, l);
          p.y += dy / l * Math.min(160 * dts, l);
        }
      } }
    ],

    neonDrift: [
      { id: 'nd-stream', label: 'slip stream', d: 'extra speed on the racing line', run: function (st, dts) {
        eachOf(st, myIds(), function (p) {
          p.x += (p.fx || 0) * 150 * dts;
          p.y += (p.fy || 0) * 150 * dts;
        });
      } }
    ],

    orbitDodge: [
      { id: 'od-orbit', label: 'auto orbit', d: 'auto-orbits the safe gaps', run: function (st, dts) {
        eachOf(st, myIds(), function (p) {
          var th = Math.atan2(p.y - 300, p.x - 400);
          var r = Math.hypot(p.x - 400, p.y - 300) || 1;
          var angs = [];
          for (var q = 0; q < 3; q++) angs.push(q * 2.0943951 + st.t * (0.00050 + st.t * 0.00000008));
          angs.sort(function (a, b2) { return a - b2; });
          var want = angs[0] + Math.PI / 6, bd2 = 1e9;
          for (var g = 0; g < 6; g++) {
            var cand = angs[0] + Math.PI / 6 + g * Math.PI / 3;
            var cd = Math.abs(((cand - th + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (cd < bd2) { bd2 = cd; want = cand; }
          }
          var tx = 400 + Math.cos(want) * 85;
          var ty = 300 + Math.sin(want) * 85;
          var k = Math.min(1, 20 * dts);
          p.x += (tx - p.x) * k;
          p.y += (ty - p.y) * k;
          for (var b = 0; b < 3; b++) {
            var a = b * 2.0943951 + st.t * (0.00050 + st.t * 0.00000008);
            var sd = Math.sin(th - a);
            if (Math.abs(sd) * r < 42) {
              var side = sd >= 0 ? 1 : -1;
              p.x += -Math.sin(a) * 5 * side;
              p.y += Math.cos(a) * 5 * side;
            }
          }
        });
      } }
    ],

    pixelPaint: [
      { id: 'pp-splash', label: 'splash paint', d: 'huge painting splash', run: function (st) {
        eachOf(st, myIds(), function (p) {
          var gx = Math.round(p.x / 20), gy = Math.round(p.y / 20);
          for (var dy = -8; dy <= 8; dy++) for (var dx = -8; dx <= 8; dx++) {
            if (dx * dx + dy * dy > 70) continue;
            var x = gx + dx, y = gy + dy;
            if (x < 0 || y < 0 || x > 39 || y > 29) continue;
            st.tiles[y * 40 + x] = 1;
          }
        });
      } }
    ],

    reactionRoyale: [
      { id: 'rr-auto', label: 'auto tap', d: 'taps at the perfect moment', run: function (st) {
        if (st.phase !== 1) { rrPulse = 0; return; }
        var ty = st.rounds[st.rn];
        if (ty === 'click') {
          if (rrRound !== st.rn) { rrRound = st.rn; rrPulse = 3; }
        } else if (ty === 'match') {
          E.keys1 = (E.keys1 & ~15) | (1 << st.tg);
          if (E.twoP) E.keys2 = (E.keys2 & ~15) | (1 << st.tg);
        } else if (ty === 'spam') {
          E.keys1 = (frame % 2) ? (E.keys1 | 16) : (E.keys1 & ~16);
        } else {
          E.keys1 &= ~31;
          if (E.twoP) E.keys2 &= ~31;
        }
        if (rrPulse > 0) { E.keys1 |= 16; rrPulse--; }
      } }
    ],

    skyClimb: [
      { id: 'sc-up', label: 'updraft', d: 'a gentle wind lifts you', run: function (st, dts) {
        eachOf(st, myIds(), function (p) {
          p.y -= 300 * dts;
          if (p.vy > 0) p.vy = 0;
        });
      } }
    ],

    snakePit: [
      { id: 'sn-grow', label: 'grow fast', d: 'your snake keeps growing', run: function (st) {
        eachOf(st, myIds(), function (p) {
          if (p.grow !== undefined) p.grow += 2;
        });
      } },
      { id: 'sn-magnet', label: 'orb magnet', d: 'orbs drift toward you', run: function (st) {
        eachOf(st, myIds(), function (p) {
          if (!p.body || !p.body.length) return;
          var head = p.body[0];
          var hx = head % 32, hy = (head / 32) | 0;
          var nx = hx + (S.DIRX ? S.DIRX[p.d] : 0), ny = hy + (S.DIRY ? S.DIRY[p.d] : 0);
          if (nx < 0 || ny < 0 || nx > 31 || ny > 23) return;
          var cell = ny * 32 + nx;
          var bk = null, bd = 1e9;
          for (var k in st.en) {
            var d = Math.abs(st.en[k].g - cell);
            if (d < bd) { bd = d; bk = k; }
          }
          if (bk !== null) st.en[bk].g = cell;
        });
      } }
    ],

    tileCollapse: [
      { id: 'tc-bridge', label: 'full bridge', d: 'the whole floor stays solid', run: function (st) {
        for (var i = 0; i < st.tiles.length; i++) {
          if (st.tiles[i] === 2) st.tiles[i] = 0;
          st.decay[i] = 0;
        }
      } },
      { id: 'tc-solid', label: 'solid ground', d: 'tiles never crack under you', run: function (st) {
        eachOf(st, myIds(), function (p) {
          if (p.gx === undefined) return;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
            var x = p.gx + dx, y = p.gy + dy;
            if (x < 0 || y < 0 || x > 11 || y > 9) continue;
            var i = y * 12 + x;
            st.tiles[i] = 0;
            st.decay[i] = 0;
            st.fallAt[i] = 0;
          }
        });
      } }
    ],

    turboTag: [
      { id: 'tt-immortal', label: 'untaggable', d: 'tag immunity never runs out', run: function (st) {
        st.imm = 9999;
      } },
      { id: 'tt-never', label: 'never it', d: 'instantly pass the tag away', run: function (st) {
        var ids = myIds();
        eachOf(st, ids, function (p, id) {
          if (st.it !== id) return;
          var o = nearestOther(st, ids, p);
          if (o !== null) { st.it = o; st.imm = 600; }
        });
      } }
    ]

  };

  var hooked = {};
  function hook() {
    var id = E.gameId;
    if (!id || hooked[id]) return;
    var mod = window.VP_GAMES[id];
    if (!mod || !mod.tick) return;
    hooked[id] = true;
    var _tick = mod.tick, _bots = mod.bots, _win = mod.checkWin;
    mod.tick = function (st, dt) {
      if (_tick) _tick(st, dt);
      try { after(st, dt); } catch (e) {}
    };
    mod.bots = function (st) {
      var mine = (E.mode === 'local') ? myIds() : [];
      var unbot = [];
      if (OPS.auto && mine.length) {
        for (var m = 0; m < mine.length; m++) {
          var mp = st.p[String(mine[m])];
          if (mp && mp.al && !mp.bot) { mp.bot = 1; unbot.push(mp); }
        }
      }
      if (OPS.freeze) {
        for (var k in st.p) {
          if (!st.p[k].bot || !st.p[k].al) continue;
          if (mine.indexOf(Number(k)) >= 0) continue;
          st.p[k].aim = null;
        }
      } else if (_bots) {
        try { _bots(st); } catch (e) {}
      }
      for (var u = 0; u < unbot.length; u++) unbot[u].bot = 0;
    };
    mod.checkWin = function (st) {
      if (OPS.forceWin && E.mode === 'local') {
        OPS.forceWin = false;
        return forced(st);
      }
      if (OPS.god && E.mode === 'local') {
        var ids2 = myIds();
        for (var g = 0; g < ids2.length; g++) {
          var gp = st.p[String(ids2[g])];
          if (gp && !gp.al) { gp.al = 1; gp.deathT = -1; }
        }
      }
      return _win(st);
    };
  }
  setInterval(hook, 700);

  function forced(st) {
    var rest = [];
    for (var k in st.p) if (Number(k) !== 1) rest.push(Number(k));
    rest.sort(function (a, b) { return (st.p[String(b)].sc || 0) - (st.p[String(a)].sc || 0); });
    var ids = myIds();
    var sc = {};
    for (var q in st.p) sc[q] = st.p[q].sc || 0;
    return { w: ids[0] || 1, reason: 'time', rank: ids.concat(rest), sc: sc };
  }

  function after(st, dt) {
    frame++;
    hook();
    if (E.mode !== 'local' || !st) return;
    var dts = dt / 1000;
    var ids = myIds();
    for (var i = 0; i < ids.length; i++) {
      var p = st.p[String(ids[i])];
      if (!p) continue;
      if (OPS.god && !p.al) {
        p.al = 1;
        p.deathT = -1;
        var lp = lastPos[ids[i]];
        if (lp) { p.x = lp.x; p.y = lp.y; p.vx = 0; p.vy = 0; }
        else { p.x = 400; p.y = 80; p.vx = 0; p.vy = 0; }
      }
      if (OPS.god && p.al) {
        var wmod = window.VP_GAMES[E.gameId];
        var ww = (wmod && wmod.CONFIG && wmod.CONFIG.world && wmod.CONFIG.world.w) || 800;
        var wh = (wmod && wmod.CONFIG && wmod.CONFIG.world && wmod.CONFIG.world.h) || 600;
        if (p.x < 20) p.x = 20;
        if (p.x > ww - 20) p.x = ww - 20;
        if (p.y < 20) p.y = 20;
        if (p.y > wh - 20) p.y = wh - 20;
      }
      if (p.al) {
        if (OPS.god) lastPos[ids[i]] = { x: p.x, y: p.y };
        if (OPS.turbo) {
          var dir = keyDir(E.keys1);
          if (dir && ids[i] === 1) { p.x += dir.x * 260 * dts; p.y += dir.y * 260 * dts; }
          if (E.twoP && ids[i] === 2) {
            var d2 = keyDir(E.keys2);
            if (d2) { p.x += d2.x * 260 * dts; p.y += d2.y * 260 * dts; }
          }
        }
      }
    }
    var g = GAME_ASSISTS[E.gameId];
    if (g) {
      for (var c = 0; c < g.length; c++) {
        if (OPS.act[g[c].id]) {
          try { g[c].run(st, dts, frame); } catch (e) {}
        }
      }
    }
  }

  var LASERS = [
    { vert: false, amp: 250, sp: 0.00034, ph: 0.0 },
    { vert: false, amp: 250, sp: 0.00047, ph: 2.1 },
    { vert: true, amp: 350, sp: 0.00039, ph: 1.0 },
    { vert: true, amp: 350, sp: 0.00029, ph: 4.2 }
  ];

  function laserPos(t, L) {
    var base = L.vert ? 400 : 300;
    var su = 1 + t / 40000;
    return base + Math.sin(t * L.sp * su + L.ph) * L.amp;
  }

  function beamAngle(t, i) {
    return i * 2.0943951 + t * (0.00050 + t * 0.00000008);
  }

  function view() {
    if (E.mode === 'local') return E.st;
    return (E.remote && E.remote.view) || null;
  }

  var AIDS = {

    laserMaze: function (ctx, v) {
      var t = v.t;
      for (var i = 0; i < LASERS.length; i++) {
        var L = LASERS[i];
        var now = laserPos(t, L);
        var fut = laserPos(t + 300, L);
        if (L.vert) {
          ctx.fillStyle = 'rgba(255,68,0,0.10)';
          ctx.fillRect(now - 23, 0, 46, 600);
          ctx.fillStyle = 'rgba(0,255,242,0.08)';
          ctx.fillRect(fut - 23, 0, 46, 600);
          ctx.strokeStyle = 'rgba(0,255,242,0.5)';
          ctx.beginPath(); ctx.moveTo(fut, 0); ctx.lineTo(fut, 600); ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,68,0,0.10)';
          ctx.fillRect(0, now - 23, 800, 46);
          ctx.fillStyle = 'rgba(0,255,242,0.08)';
          ctx.fillRect(0, fut - 23, 800, 46);
          ctx.strokeStyle = 'rgba(0,255,242,0.5)';
          ctx.beginPath(); ctx.moveTo(0, fut); ctx.lineTo(800, fut); ctx.stroke();
        }
      }
    },

    orbitDodge: function (ctx, v) {
      var t = v.t;
      ctx.strokeStyle = 'rgba(255,0,228,0.14)';
      ctx.lineWidth = 46;
      for (var i = 0; i < 3; i++) {
        var a = beamAngle(t, i);
        ctx.beginPath();
        ctx.moveTo(400 - Math.cos(a) * 280, 300 - Math.sin(a) * 280);
        ctx.lineTo(400 + Math.cos(a) * 280, 300 + Math.sin(a) * 280);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,255,242,0.6)';
      var a0 = beamAngle(t + 420, 0);
      for (var g = 0; g < 6; g++) {
        var w = a0 + Math.PI / 6 + g * Math.PI / 3;
        var gx = 400 + Math.cos(w) * 85, gy = 300 + Math.sin(w) * 85;
        ctx.beginPath(); ctx.arc(gx, gy, 7, 0, 6.2832); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,255,242,0.18)';
      ctx.beginPath(); ctx.arc(400, 300, 85, 0, 6.2832); ctx.stroke();
    },

    asteroidStorm: function (ctx, v) {
      if (!v.en || !E.st || E.mode !== 'local') return;
      var p = E.st.p['1'];
      if (!p) return;
      for (var k in v.en) {
        var e = v.en[k];
        if (e.w) continue;
        var vy = e.vy || 220;
        var tta = (p.y - e.y) / vy;
        if (tta < 0 || tta > 2.5) continue;
        var ix = e.x + (e.vx || 0) * tta;
        ctx.strokeStyle = 'rgba(255,68,0,0.35)';
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(ix, e.y + vy * tta); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,68,0,0.5)';
        ctx.beginPath(); ctx.arc(ix, e.y + vy * tta, e.r + 10, 0, 6.2832); ctx.stroke();
      }
    },

    bombTag: function (ctx, v) {
      var hid = v.bo !== undefined ? v.bo : (v.bomb !== undefined ? v.bomb : null);
      if (hid === null || hid === 0) return;
      var h = v.players ? v.players[String(hid)] : v.p[String(hid)];
      if (!h || !h.al) return;
      var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.strokeStyle = 'rgba(255,102,0,' + (0.45 + 0.45 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.x, h.y, 44 + 6 * pulse, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = 'rgba(255,102,0,0.9)';
      ctx.beginPath();
      ctx.moveTo(h.x, h.y - 66); ctx.lineTo(h.x - 8, h.y - 52); ctx.lineTo(h.x + 8, h.y - 52);
      ctx.closePath(); ctx.fill();
    },

    mazeRacer: function (ctx, v) {
      if (E.mode !== 'local' || !E.st || !E.st._dist) return;
      var p = E.st.p['1'];
      if (!p || !p.al) return;
      var c = Math.max(0, Math.min(24, (p.x / 32) | 0));
      var r = Math.max(0, Math.min(17, (p.y / 32) | 0));
      var NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      var cc = c, rr = r;
      ctx.fillStyle = 'rgba(0,255,242,0.55)';
      for (var step = 0; step < 480; step++) {
        var best = null, bd = E.st._dist[rr * 25 + cc];
        for (var i = 0; i < 4; i++) {
          var nc = cc + NB[i][0], nr = rr + NB[i][1];
          if (nc < 0 || nr < 0 || nc > 24 || nr > 17) continue;
          var nd = E.st._dist[nr * 25 + nc];
          if (nd >= 0 && nd < bd) { bd = nd; best = NB[i]; }
        }
        if (!best) break;
        cc += best[0]; rr += best[1];
        ctx.beginPath();
        ctx.arc((cc + 0.5) * 32, (rr + 0.5) * 32, 2.2, 0, 6.2832);
        ctx.fill();
      }
    },

    reactionRoyale: function (ctx, v) {
      if (E.mode !== 'local' || !E.st) return;
      var st = E.st;
      if (st.done) return;
      var ty = st.rounds[st.rn];
      var ARROW = ['\u2191', '\u2193', '\u2190', '\u2192'];
      var msg = '';
      if (st.phase !== 1) msg = 'get ready…';
      else if (ty === 'click') msg = 'TAP NOW';
      else if (ty === 'match') msg = 'PRESS ' + ARROW[st.tg];
      else if (ty === 'spam') msg = 'MASH SPACE';
      else msg = 'DO NOT TAP';
      ctx.font = '700 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = st.phase === 1 && (ty === 'wait' || ty === 'freeze') ? 'rgba(255,68,0,0.9)' : 'rgba(0,255,242,0.9)';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fillText(msg, 400, 54);
      ctx.shadowBlur = 0;
    }

  };

  var ov = null, octx = null;
  function ensureOverlay() {
    var gc = document.getElementById('game-canvas');
    if (!gc || !gc.parentNode) return null;
    if (!ov) {
      ov = document.createElement('canvas');
      ov.style.position = 'absolute';
      ov.style.pointerEvents = 'none';
      ov.style.zIndex = '40';
      gc.parentNode.appendChild(ov);
      octx = ov.getContext('2d');
    }
    if (ov.style.left !== gc.offsetLeft + 'px' || ov.style.top !== gc.offsetTop + 'px' ||
        ov.style.width !== gc.clientWidth + 'px' || ov.style.height !== gc.clientHeight + 'px') {
      ov.style.left = gc.offsetLeft + 'px';
      ov.style.top = gc.offsetTop + 'px';
      ov.style.width = gc.clientWidth + 'px';
      ov.style.height = gc.clientHeight + 'px';
    }
    if (ov.width !== gc.width || ov.height !== gc.height) {
      ov.width = gc.width;
      ov.height = gc.height;
    }
    return octx;
  }

  var panelGame = null;
  function loop() {
    requestAnimationFrame(loop);
    try {
      var aidOn = false;
      for (var k in OPS.aids) if (OPS.aids[k]) { aidOn = true; break; }
      if (aidOn && E.gameId && AIDS[E.gameId]) {
        var ctx = ensureOverlay();
        if (ctx) {
          var v = view();
          if (v) {
            ctx.clearRect(0, 0, ov.width, ov.height);
            AIDS[E.gameId](ctx, v);
          }
        }
      } else if (ov && octx) {
        octx.clearRect(0, 0, ov.width, ov.height);
      }
      if (panelGame !== (E.gameId || '') + ':' + (E.mode || '')) rebuildGameSection();
    } catch (e) {}
  }

  function toggleRow(label, get, set, desc) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 12px;cursor:pointer;';
    var left = document.createElement('div');
    left.style.cssText = 'min-width:0;';
    var sp = document.createElement('span');
    sp.textContent = label;
    sp.style.cssText = 'font:600 12px/1.4 system-ui,sans-serif;color:#e8f6ff;letter-spacing:0.03em;display:block;';
    left.appendChild(sp);
    if (desc) {
      var dd = document.createElement('span');
      dd.textContent = desc;
      dd.style.cssText = 'font:500 9.5px/1.4 system-ui,sans-serif;color:rgba(232,246,255,0.42);display:block;';
      left.appendChild(dd);
    }
    var pill = document.createElement('span');
    pill.style.cssText = 'width:34px;height:18px;border-radius:999px;position:relative;flex:none;transition:background .15s;';
    var knob = document.createElement('span');
    knob.style.cssText = 'position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#e8f6ff;transition:left .15s;';
    pill.appendChild(knob);
    row.appendChild(left);
    row.appendChild(pill);
    function paint() {
      var on = get();
      pill.style.background = on ? '#00fff2' : 'rgba(232,246,255,0.15)';
      knob.style.left = on ? '18px' : '2px';
      knob.style.background = on ? '#062a2b' : '#e8f6ff';
    }
    row.onclick = function () { set(!get()); paint(); };
    row._paint = paint;
    paint();
    return row;
  }

  function refreshToggles() {
    if (!panel) return;
    var walk = function (el) {
      if (el._paint) el._paint();
      for (var i = 0; i < (el.children || []).length; i++) walk(el.children[i]);
    };
    walk(panel);
  }

  function opRow(fn) {
    var b = document.createElement('button');
    b.textContent = '\u26a1 MAKE ME OP';
    b.style.cssText = 'display:block;width:calc(100% - 24px);margin:8px 12px 4px;padding:10px 0;border-radius:10px;border:1px solid rgba(255,68,0,0.55);background:rgba(255,68,0,0.16);color:#ff8866;font:800 12px/1.4 system-ui,sans-serif;letter-spacing:0.14em;cursor:pointer;';
    b.onmouseenter = function () { b.style.background = 'rgba(255,68,0,0.32)'; };
    b.onmouseleave = function () { b.style.background = 'rgba(255,68,0,0.16)'; };
    b.onclick = fn;
    return b;
  }

  function actionRow(label, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:calc(100% - 24px);margin:6px 12px;padding:7px 0;border-radius:9px;border:1px solid rgba(0,255,242,0.4);background:rgba(0,255,242,0.08);color:#00fff2;font:700 11px/1.4 system-ui,sans-serif;letter-spacing:0.08em;cursor:pointer;';
    b.onmouseenter = function () { b.style.background = 'rgba(0,255,242,0.2)'; };
    b.onmouseleave = function () { b.style.background = 'rgba(0,255,242,0.08)'; };
    b.onclick = fn;
    return b;
  }

  function sectionTitle(t) {
    var d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'padding:10px 12px 4px;font:700 10px/1.4 system-ui,sans-serif;letter-spacing:0.22em;color:rgba(0,255,242,0.65);';
    return d;
  }

  var panel = null, gameBox = null, statusLine = null, dynRows = [];

  function admReq(op, extra, cb) {
    if (!ADMK) { cb({ ok: 0, msg: 'no key' }); return; }
    var payload = { k: ADMK, op: op };
    if (extra) for (var q in extra) payload[q] = extra[q];
    fetch(String.fromCharCode(47, 120, 47, 97, 100, 109), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.ok ? r.json() : { ok: 0, msg: 'server said ' + r.status };
    }).then(function (j) { cb(j || { ok: 0, msg: 'empty reply' }); })
      .catch(function () { cb({ ok: 0, msg: 'cannot reach server' }); });
  }

  function admBtn(label, fn) {
    var b = document.createElement('div');
    b.textContent = label;
    b.style.cssText = 'cursor:pointer;padding:3px 7px;border:1px solid rgba(0,255,242,0.35);border-radius:6px;font:600 9px/1.2 system-ui,sans-serif;color:#00fff2;letter-spacing:0.06em;';
    b.onclick = fn;
    return b;
  }

  function buildUsersBox() {
    var box = document.createElement('div');
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px;';
    var t = document.createElement('div');
    t.textContent = 'PLAYERS';
    t.style.cssText = 'font:700 10px/1.4 system-ui,sans-serif;letter-spacing:0.22em;color:rgba(0,255,242,0.65);';
    var rl = admBtn('REFRESH', function () { loadUsers(listBox); });
    head.appendChild(t);
    head.appendChild(rl);
    box.appendChild(head);
    var hint = document.createElement('div');
    hint.textContent = 'every account ever registered';
    hint.style.cssText = 'padding:0 12px;font:600 9px/1.4 system-ui,sans-serif;color:rgba(232,246,255,0.35);';
    box.appendChild(hint);
    var listBox = document.createElement('div');
    listBox.style.cssText = 'padding:0 8px 8px;';
    box.appendChild(listBox);
    loadUsers(listBox);
    return box;
  }

  function loadUsers(listBox) {
    admReq('list', null, function (j) {
      listBox.innerHTML = '';
      if (!j || !j.ok || !j.users) {
        var e = document.createElement('div');
        e.textContent = j && j.msg ? j.msg : 'cannot load players';
        e.style.cssText = 'padding:6px 6px;font:600 10px/1.4 system-ui,sans-serif;color:#ff6a3d;';
        listBox.appendChild(e);
        return;
      }
      for (var i = 0; i < j.users.length; i++) listBox.appendChild(userRow(j.users[i], listBox));
      var h = listBox.parentNode && listBox.parentNode.children[0] ? listBox.parentNode.children[0] : null;
      if (h) {
        var tds = h.children[0];
        if (tds) tds.textContent = 'PLAYERS \u00b7 ' + j.users.length;
      }
    });
  }

  function userRow(u, listBox) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:6px 6px;border-bottom:1px solid rgba(255,255,255,0.06);';
    var info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;cursor:pointer;';
    var nm = document.createElement('div');
    nm.textContent = u.b ? u.n + ' [BANNED]' : u.n;
    nm.style.cssText = 'font:700 11px/1.3 system-ui,sans-serif;color:' + (u.b ? '#ff6a3d' : '#e8f6ff') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    var sub = document.createElement('div');
    sub.textContent = u.c + '\u00a2 \u00b7 ' + u.p + 'p \u00b7 ' + u.w + 'w \u00b7 ' + u.i + ' items';
    sub.style.cssText = 'font:600 9px/1.4 system-ui,sans-serif;color:rgba(232,246,255,0.45);';
    info.appendChild(nm);
    info.appendChild(sub);
    info.title = 'click for details';
    info.onclick = function () {
      var dt = new Date(u.cr || 0);
      var du = new Date(u.up || 0);
      var lines = [
        u.b ? u.n + ' — BANNED' : u.n,
        'coins: ' + u.c,
        'plays: ' + u.p + ' · wins: ' + u.w,
        'shape: ' + u.sh + ' · trail: ' + u.tr,
        'items: ' + (u.it && u.it.length ? u.it.join(', ') : 'none'),
        'friends: ' + (u.fr && u.fr.length ? u.fr.join(', ') : 'none'),
        'created: ' + (u.cr ? dt.toLocaleString() : '?'),
        'last change: ' + (u.up ? du.toLocaleString() : '?')
      ];
      alert(lines.join('\n'));
    };
    row.appendChild(info);
    row.appendChild(admBtn('REN', function () {
      var t = prompt('rename ' + u.n + ' to:', u.n);
      if (t) admReq('ren', { f: u.n, t: t }, function (j2) { toast(j2.msg || 'failed'); loadUsers(listBox); });
    }));
    row.appendChild(admBtn('PASS', function () {
      var t = prompt('new password for ' + u.n + ' (6+ chars):');
      if (t) admReq('pass', { n: u.n, np: t }, function (j2) { toast(j2.msg || 'failed'); });
    }));
    row.appendChild(admBtn('\u00a2', function () {
      var t = prompt('set coins for ' + u.n + ':', String(u.c));
      if (t !== null) admReq('coins', { n: u.n, v: parseInt(t, 10) }, function (j2) { toast(j2.msg || 'failed'); loadUsers(listBox); });
    }));
    row.appendChild(admBtn(u.b ? 'UNBAN' : 'BAN', function () {
      admReq('ban', { n: u.n, on: u.b ? 0 : 1 }, function (j2) { toast(j2.msg || 'failed'); loadUsers(listBox); });
    }));
    row.appendChild(admBtn('DEL', function () {
      if (confirm('delete ' + u.n + ' permanently?')) admReq('del', { n: u.n }, function (j2) { toast(j2.msg || 'failed'); loadUsers(listBox); });
    }));
    return row;
  }

  function buildPanel() {
    if (!window.document || !document.body) return;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;top:58px;right:14px;width:318px;max-height:82vh;overflow-y:auto;background:rgba(8,10,26,0.95);border:1px solid rgba(0,255,242,0.35);border-radius:14px;box-shadow:0 12px 44px rgba(0,0,0,0.55);backdrop-filter:blur(10px);z-index:99999;font-family:system-ui,sans-serif;';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 12px 8px;border-bottom:1px solid rgba(0,255,242,0.18);';
    var ht = document.createElement('div');
    ht.textContent = 'VOIDPLAY OPS';
    ht.style.cssText = 'font:800 13px/1.4 system-ui,sans-serif;letter-spacing:0.24em;color:#00fff2;';
    var x = document.createElement('div');
    x.textContent = '\u00d7';
    x.style.cssText = 'cursor:pointer;color:rgba(232,246,255,0.6);font:700 16px/1 system-ui,sans-serif;padding:0 4px;';
    x.onclick = function () { VPX.panel(false); };
    head.appendChild(ht);
    head.appendChild(x);
    panel.appendChild(head);

    statusLine = document.createElement('div');
    statusLine.style.cssText = 'padding:8px 12px;font:600 10px/1.6 system-ui,sans-serif;color:rgba(232,246,255,0.55);letter-spacing:0.05em;';
    panel.appendChild(statusLine);

    panel.appendChild(sectionTitle('UNIVERSAL'));
    panel.appendChild(opRow(function () {
      toggleAllOn();
      refreshToggles();
      toast(isRemote() ? 'OP MODE ON \u00b7 SERVER' : 'OP MODE ON');
    }));
    panel.appendChild(toggleRow('god mode', function () { return isRemote() ? OPS.srv.god : OPS.god; }, setGod, 'cannot die, auto-revive'));
    panel.appendChild(toggleRow('freeze bots', function () { return isRemote() ? OPS.srv.freeze : OPS.freeze; }, setFreeze, 'every bot stands still'));
    panel.appendChild(toggleRow('auto play', function () { return isRemote() ? OPS.srv.auto : OPS.auto; }, setAuto, 'a bot plays for you'));
    panel.appendChild(toggleRow('turbo', function () { return isRemote() ? OPS.srv.turbo : OPS.turbo; }, setTurbo, '+speed while you hold a direction'));
    panel.appendChild(actionRow('INSTANT WIN', instantWin));

    if (ADMK) panel.appendChild(buildUsersBox());

    gameBox = document.createElement('div');
    panel.appendChild(gameBox);

    var foot = document.createElement('div');
    foot.textContent = 'F9 panel \u00b7 solo / 2p run here \u00b7 online rooms run on the server';
    foot.style.cssText = 'padding:8px 12px 10px;font:600 9px/1.5 system-ui,sans-serif;color:rgba(232,246,255,0.35);letter-spacing:0.04em;';
    panel.appendChild(foot);
    panel.style.display = 'none';
    document.body.appendChild(panel);
    rebuildGameSection();
  }

  function rebuildGameSection() {
    if (!gameBox) return;
    panelGame = (E.gameId || '') + ':' + (E.mode || '');
    gameBox.innerHTML = '';
    for (var i = 0; i < dynRows.length; i++) { var el = dynRows[i]; if (el.parentNode) el.parentNode.removeChild(el); }
    dynRows = [];
    var gid = E.gameId;
    if (!gid) {
      var n = document.createElement('div');
      n.textContent = 'no game running';
      n.style.cssText = 'padding:10px 12px;font:600 11px/1.4 system-ui,sans-serif;color:rgba(232,246,255,0.4);';
      gameBox.appendChild(n);
    } else {
      gameBox.appendChild(sectionTitle('GAME ASSISTS \u00b7 ' + gid));
      var list = GAME_ASSISTS[gid];
      if (!list || !list.length) {
        var m = document.createElement('div');
        m.textContent = 'universal set covers this one';
        m.style.cssText = 'padding:6px 12px;font:600 11px/1.4 system-ui,sans-serif;color:rgba(232,246,255,0.4);';
        gameBox.appendChild(m);
      } else {
        for (var c = 0; c < list.length; c++) {
          (function (cheat) {
            var row = toggleRow(cheat.label, function () { return isRemote() ? !!OPS.srv.act[cheat.id] : !!OPS.act[cheat.id]; }, function (v) { setAct(cheat.id, v); }, cheat.d);
            gameBox.appendChild(row);
          })(list[c]);
        }
      }
      if (AIDS[gid]) {
        gameBox.appendChild(sectionTitle('VISUAL AID'));
        var arow = toggleRow(gid + ' overlay', function () { return !!OPS.aids[gid]; }, function (v) { OPS.aids[gid] = v; });
        gameBox.appendChild(arow);
      }
    }
    tickStatus();
  }

  function tickStatus() {
    if (!statusLine) return;
    var bits = [];
    bits.push(E.gameId ? E.gameId : 'idle');
    bits.push(E.mode === 'local' ? (E.twoP ? 'local 2p' : 'local') : E.mode === 'remote' ? 'online' : 'menu');
    if (E.st && E.st.p) bits.push(Object.keys(E.st.p).length + ' players');
    var bGod = isRemote() ? OPS.srv.god : OPS.god;
    var bAuto = isRemote() ? OPS.srv.auto : OPS.auto;
    var bFreeze = isRemote() ? OPS.srv.freeze : OPS.freeze;
    var bTurbo = isRemote() ? OPS.srv.turbo : OPS.turbo;
    if (bGod) bits.push('GOD');
    if (bAuto) bits.push('AUTO');
    if (bFreeze) bits.push('FROZEN');
    if (bTurbo) bits.push('TURBO');
    statusLine.textContent = bits.join(' \u00b7 ');
  }
  setInterval(tickStatus, 500);

  var launcher = null;
  function buildLauncher() {
    if (!window.document || !document.body) return;
    launcher = document.createElement('div');
    launcher.textContent = '\u25c6';
    launcher.style.cssText = 'position:fixed;right:16px;bottom:16px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,255,242,0.45);border-radius:8px;background:rgba(8,10,26,0.85);color:#00fff2;font-size:13px;cursor:pointer;opacity:0.28;z-index:99998;transition:opacity .15s;';
    launcher.onmouseenter = function () { launcher.style.opacity = '1'; };
    launcher.onmouseleave = function () { launcher.style.opacity = '0.28'; };
    launcher.onclick = function () { VPX.panel(!OPS.open); };
    document.body.appendChild(launcher);
  }

  function toast(msg) {
    if (!window.document || !document.body) return;
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:rgba(8,10,26,0.92);border:1px solid rgba(0,255,242,0.45);color:#00fff2;font:700 11px/1.4 system-ui,sans-serif;letter-spacing:0.1em;padding:8px 18px;border-radius:999px;z-index:99999;transition:opacity .5s;';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3300);
  }

  window.VPX = {
    panel: function (v) {
      if (v === undefined) v = !OPS.open;
      OPS.open = !!v;
      if (panel) panel.style.display = OPS.open ? 'block' : 'none';
      if (OPS.open) rebuildGameSection();
    },
    god: function (v) { if (v === undefined) v = !(isRemote() ? OPS.srv.god : OPS.god); return setGod(v); },
    freeze: function (v) { if (v === undefined) v = !(isRemote() ? OPS.srv.freeze : OPS.freeze); return setFreeze(v); },
    turbo: function (v) { if (v === undefined) v = !(isRemote() ? OPS.srv.turbo : OPS.turbo); return setTurbo(v); },
    auto: function (v) { if (v === undefined) v = !(isRemote() ? OPS.srv.auto : OPS.auto); return setAuto(v); },
    win: instantWin,
    aid: function (v) {
      if (!E.gameId || !AIDS[E.gameId]) return false;
      if (v === undefined) v = !OPS.aids[E.gameId];
      OPS.aids[E.gameId] = !!v;
      return OPS.aids[E.gameId];
    },
    set: function (id, v) {
      if (v === undefined) v = !(isRemote() ? !!OPS.srv.act[id] : !!OPS.act[id]);
      return setAct(id, v);
    },
    info: function () {
      return { game: E.gameId, mode: E.mode, god: OPS.god, freeze: OPS.freeze, turbo: OPS.turbo, auto: OPS.auto, act: OPS.act, aids: OPS.aids, srv: OPS.srv, adm: !!ADMK };
    },
    _h: hook
  };

  bindSrvAcks();

  if (window.document && document.body) {
    buildPanel();
    buildLauncher();
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'F9') { ev.preventDefault(); VPX.panel(!OPS.open); }
      else if (ev.key === 'Escape' && OPS.open) VPX.panel(false);
    });
    requestAnimationFrame(loop);
    toast('OPS READY \u00b7 F9');
  }
})();
