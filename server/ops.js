'use strict';

const crypto = require('crypto');

let keyHash = null;
let frame = 0;

function init(hash) { keyHash = hash; }

function keyOk(key) {
  if (!keyHash) return false;
  const k = String(key || '').trim();
  if (!k || k.length > 512) return false;
  const h = crypto.createHash('sha256').update(k).digest();
  return h.length === keyHash.length && crypto.timingSafeEqual(h, keyHash);
}

function activeConns(players) {
  const out = [];
  for (const c of players.values()) if (c && c.ops && c.ops.on) out.push(c);
  return out;
}

function keyDir(k) {
  let x = 0, y = 0;
  if (k & 1) y -= 1;
  if (k & 2) y += 1;
  if (k & 4) x -= 1;
  if (k & 8) x += 1;
  const l = Math.hypot(x, y);
  return l ? { x: x / l, y: y / l } : null;
}

function eachOf(st, ids, fn) {
  for (const id of ids) {
    const p = st.p[String(id)];
    if (p && p.al) fn(p, id);
  }
}

function nearestOther(st, ids, p) {
  let best = null, bd = 1e9;
  for (const k in st.p) {
    const o = st.p[k];
    if (!o.al || ids.indexOf(Number(k)) >= 0) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = Number(k); }
  }
  return best;
}

function predictPuckY(pk, goalX) {
  let x = pk.x, y = pk.y, vx = pk.vx, vy = pk.vy;
  for (let i = 0; i < 240; i++) {
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

const ASSISTS = {

  asteroidStorm: [
    { id: 'as-dodge', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        for (let q = 0; q < 3; q++) {
          let best = null, bd = 1e9;
          for (const k in st.en) {
            const e = st.en[k];
            const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r;
            if (d < 150 && d < bd) { bd = d; best = e; }
          }
          if (!best) return;
          const dx = p.x - best.x, dy = p.y - best.y;
          const l = Math.hypot(dx, dy) || 1;
          p.x += (dx / l) * 6;
          p.y += (dy / l) * 6;
        }
      });
    } },
    { id: 'as-shield', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        for (const k in st.en) {
          const e = st.en[k];
          if (!e.w && Math.hypot(p.x - e.x, p.y - e.y) < 85) delete st.en[k];
        }
      });
    } }
  ],

  bombTag: [
    { id: 'bt-pass', run(st, dts, ids) {
      eachOf(st, ids, (p, id) => {
        if (st.bomb !== id) return;
        const o = nearestOther(st, ids, p);
        if (o !== null) { st.bomb = o; if (st.passCd !== undefined) st.passCd = 500; }
      });
    } },
    { id: 'bt-fuse', run(st) {
      if (st.fuse < 6500) st.fuse = 6500;
    } }
  ],

  bumperKnock: [
    { id: 'bk-bump', run(st, dts, ids) {
      eachOf(st, ids, (p) => { p.dashT = 500; });
    } }
  ],

  colorRaid: [
    { id: 'cr-brush', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        const gx = Math.round((p.x - 32) / 46), gy = Math.round((p.y - 60) / 40);
        for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
          if (dx * dx + dy * dy > 45) continue;
          const x = gx + dx, y = gy + dy;
          if (x < 0 || y < 0 || x > 15 || y > 11) continue;
          st.tiles[y * 16 + x] = p.pid;
        }
      });
    } }
  ],

  gravityWell: [
    { id: 'gw-magnet', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        for (const k in st.en) {
          const e = st.en[k];
          const dx = p.x - e.x, dy = p.y - e.y;
          const l = Math.hypot(dx, dy) || 1;
          if (l < 240) { e.x += (dx / l) * 340 * dts; e.y += (dy / l) * 340 * dts; }
        }
      });
    } },
    { id: 'gw-repel', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        const dx = p.x - 400, dy = p.y - 300;
        const r = Math.hypot(dx, dy) || 1;
        if (r < 175) { p.vx += dx / r * 1600 * dts; p.vy += dy / r * 1600 * dts; }
        for (const k in st.en) {
          const e = st.en[k];
          if (Math.hypot(p.x - e.x, p.y - e.y) < 75) delete st.en[k];
        }
      });
    } }
  ],

  hoverHockey: [
    { id: 'hh-keeper', run(st, dts, ids) {
      if (!st.puck) return;
      const pk = st.puck;
      for (const id of ids) {
        const p = st.p[id];
        if (!p || !p.al) continue;
        const team = p.team !== undefined ? p.team : (p.slot - 1) % 2;
        const left = team === 0;
        const line = left ? 40 : 760;           // where the keeper stands
        const cross = predictPuckY(pk, left ? 20 : 780); // y when the puck reaches the goal line
        let ty;
        if (cross !== null && cross > 232 && cross < 368) ty = Math.max(239, Math.min(361, cross)); // shot on goal: stand on its path
        else ty = Math.max(250, Math.min(350, pk.y));                                               // no threat: hover and track
        if (left ? pk.x < 36 : pk.x > 764) {                                                          // puck behind me: body-block
          p.x = Math.max(20, Math.min(780, left ? pk.x - 18 : pk.x + 18));
          p.y = Math.max(232, Math.min(368, pk.y));
        } else {
          p.x = line;
          p.y = ty;
        }
        p.vx = 0; p.vy = 0;
      }
    } },
    { id: 'hh-shot', run(st, dts, ids) {
      const pk = st.puck;
      if (!pk) return;
      eachOf(st, ids, (p) => {
        const d = Math.hypot(pk.x - p.x, pk.y - p.y);
        if (d > 120) return;
        const team = (p.slot - 1) % 2;
        const tx = team === 0 ? 860 : -60;
        const dx = tx - pk.x, dy = 300 - pk.y;
        const l = Math.hypot(dx, dy) || 1;
        pk.vx = (dx / l) * 560;
        pk.vy = (dy / l) * 560;
      });
    } },
    { id: 'hh-magnet', run(st, dts, ids) {
      if (!st.puck) return;
      eachOf(st, ids, (p) => {
        const gx = ((p.slot - 1) % 2) === 0 ? 830 : -30;
        const dx = gx - st.puck.x, dy = 300 - st.puck.y;
        const l = Math.hypot(dx, dy) || 1;
        const near = Math.hypot(p.x - st.puck.x, p.y - st.puck.y) < 220;
        const push = (near ? 1500 : 420) * dts;
        st.puck.vx += dx / l * push;
        st.puck.vy += dy / l * push * 0.6;
      });
    } }
  ],

  infected: [
    { id: 'in-immune', run(st, dts, ids) {
      eachOf(st, ids, (p, id) => {
        if (st.inf !== id) return;
        const o = nearestOther(st, ids, p);
        if (o !== null) st.inf = o;
      });
    } }
  ],

  juggernaut: [
    { id: 'jg-always', run(st, dts, ids) {
      eachOf(st, ids, () => { st.jg = ids[0]; });
    } }
  ],

  kingOfTheHill: [
    { id: 'kh-warp', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        p.x = 408; p.y = 300; p.vx = 0; p.vy = 0;
      });
    } },
    { id: 'kh-score', run(st, dts, ids) {
      eachOf(st, ids, (p) => { p.sc += 2 * dts; });
    } }
  ],

  laserMaze: [
    { id: 'lm-calm', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        p.x += (400 - p.x) * 0.02;
        p.y += (300 - p.y) * 0.02;
      });
    } }
  ],

  lavaFloor: [
    { id: 'lv-moon', run(st, dts, ids, f, onInput) {
      if (f % 4 < 2) onInput(ids[0], 16);
      else onInput(ids[0], 0);
    } },
    { id: 'lv-hover', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        p.y -= 130 * dts;
        if (p.vy > 0) p.vy = 0;
      });
    } }
  ],

  mazeRacer: [
    { id: 'mr-steer', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        if (!st._dist) return;
        const c = Math.max(0, Math.min(24, (p.x / 32) | 0));
        const r = Math.max(0, Math.min(17, (p.y / 32) | 0));
        let best = null, bd = st._dist[r * 25 + c];
        const NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (let i = 0; i < 4; i++) {
          const nc = c + NB[i][0], nr = r + NB[i][1];
          if (nc < 0 || nr < 0 || nc > 24 || nr > 17) continue;
          const nd = st._dist[nr * 25 + nc];
          if (nd >= 0 && nd < bd) { bd = nd; best = NB[i]; }
        }
        if (best) {
          const tx = (c + best[0] + 0.5) * 32, ty = (r + best[1] + 0.5) * 32;
          const dx = tx - p.x, dy = ty - p.y;
          const l = Math.hypot(dx, dy) || 1;
          p.x += dx / l * Math.min(160 * dts, l);
          p.y += dy / l * Math.min(160 * dts, l);
        }
      });
    } }
  ],

  neonDrift: [
    { id: 'nd-stream', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        p.x += (p.fx || 0) * 150 * dts;
        p.y += (p.fy || 0) * 150 * dts;
      });
    } }
  ],

  orbitDodge: [
    { id: 'od-orbit', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        const th = Math.atan2(p.y - 300, p.x - 400);
        const r = Math.hypot(p.x - 400, p.y - 300) || 1;
        const angs = [];
        for (let q = 0; q < 3; q++) angs.push(q * 2.0943951 + st.t * (0.00050 + st.t * 0.00000008));
        angs.sort((a, b) => a - b);
        let want = angs[0] + Math.PI / 6, bd = 1e9;
        for (let g = 0; g < 6; g++) {
          const cand = angs[0] + Math.PI / 6 + g * Math.PI / 3;
          const cd = Math.abs(((cand - th + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (cd < bd) { bd = cd; want = cand; }
        }
        const tx = 400 + Math.cos(want) * 85;
        const ty = 300 + Math.sin(want) * 85;
        const k = Math.min(1, 20 * dts);
        p.x += (tx - p.x) * k;
        p.y += (ty - p.y) * k;
        for (let b = 0; b < 3; b++) {
          const a = b * 2.0943951 + st.t * (0.00050 + st.t * 0.00000008);
          const sd = Math.sin(th - a);
          if (Math.abs(sd) * r < 42) {
            const side = sd >= 0 ? 1 : -1;
            p.x += -Math.sin(a) * 5 * side;
            p.y += Math.cos(a) * 5 * side;
          }
        }
      });
    } }
  ],

  pixelPaint: [
    { id: 'pp-splash', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        const gx = Math.round(p.x / 20), gy = Math.round(p.y / 20);
        for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
          if (dx * dx + dy * dy > 60) continue;
          const x = gx + dx, y = gy + dy;
          if (x < 0 || y < 0 || x > 39 || y > 29) continue;
          st.tiles[y * 40 + x] = p.pid;
        }
      });
    } }
  ],

  reactionRoyale: [
    { id: 'rr-auto', run(st, dts, ids, f, onInput) {
      if (st.phase !== 1) return;
      const ty = st.rounds && st.rounds[st.rn];
      const id = ids[0];
      if (ty === 'click') {
        const p = st.p[String(id)];
        if (p && st.go && !p.hit) p.hit = st.go;
      } else if (ty === 'match') {
        if (st.tg !== undefined) onInput(id, 1 << st.tg);
      } else if (ty === 'spam') {
        onInput(id, (f % 2) ? 16 : 0);
      }
    } }
  ],

  skyClimb: [
    { id: 'sc-up', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        p.y -= 300 * dts;
        if (p.vy > 0) p.vy = 0;
      });
    } }
  ],

  snakePit: [
    { id: 'sn-magnet', run(st, dts, ids) {
      const DIRX = [0, 0, -1, 1], DIRY = [-1, 1, 0, 0];
      eachOf(st, ids, (p) => {
        if (!p.body || !p.body.length) return;
        const head = p.body[0];
        const hx = head % 32, hy = (head / 32) | 0;
        const nx = hx + (DIRX[p.d] || 0), ny = hy + (DIRY[p.d] || 0);
        if (nx < 0 || ny < 0 || nx > 31 || ny > 23) return;
        const cell = ny * 32 + nx;
        let bk = null, bd = 1e9;
        for (const k in st.en) {
          const d = Math.abs(st.en[k].g - cell);
          if (d < bd) { bd = d; bk = k; }
        }
        if (bk !== null) st.en[bk].g = cell;
      });
    } },
    { id: 'sn-grow', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        if (p.grow !== undefined) p.grow += 2;
      });
    } }
  ],

  tileCollapse: [
    { id: 'tc-bridge', run(st) {
      for (let i = 0; i < st.tiles.length; i++) {
        if (st.tiles[i] === 2) st.tiles[i] = 0;
        st.decay[i] = 0;
      }
    } },
    { id: 'tc-solid', run(st, dts, ids) {
      eachOf(st, ids, (p) => {
        const c = (p.x / 40) | 0, r = (p.y / 40) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = c + dx, y = r + dy;
          if (x < 0 || y < 0 || x > 19 || y > 14) continue;
          const i = y * 20 + x;
          if (st.tiles[i] === 2) st.tiles[i] = 0;
          st.decay[i] = 0;
        }
      });
    } }
  ],

  turboTag: [
    { id: 'tt-immortal', run(st) {
      st.imm = 9999;
    } },
    { id: 'tt-never', run(st, dts, ids) {
      eachOf(st, ids, (p, id) => {
        if (st.it !== id) return;
        const o = nearestOther(st, ids, p);
        if (o !== null) { st.it = o; st.imm = 600; }
      });
    } }
  ]
};

function worldBounds(game) {
  const w = game && game.CONFIG && game.CONFIG.world ? game.CONFIG.world.w : 800;
  const h = game && game.CONFIG && game.CONFIG.world ? game.CONFIG.world.h : 600;
  return { w, h };
}

function preBots(st, conns) {
  for (const c of conns) {
    if (!c.ops.auto) continue;
    const p = st.p[String(c.pid)];
    if (p && p.al && !p.bot) { p.bot = 1; c.ops._unbot = 1; }
  }
}

function postBots(st, conns, anyFreeze) {
  for (const c of conns) {
    if (c.ops._unbot) {
      const p = st.p[String(c.pid)];
      if (p) p.bot = 0;
      c.ops._unbot = 0;
    }
  }
  if (anyFreeze) {
    for (const k in st.p) {
      const p = st.p[k];
      if (p.bot && p.al) p.aim = null;
    }
  }
}

function afterTick(st, game, gameType, conns, dt, onInput) {
  frame++;
  const dts = dt / 1000;
  const gid = gameType;
  const bounds = worldBounds(game);
  for (const c of conns) {
    const ids = [c.pid];
    const p = st.p[String(c.pid)];
    if (!p) continue;
    if (c.ops.god && !p.al) {
      p.al = 1;
      if (p.deathT !== undefined) p.deathT = -1;
      p.x = bounds.w / 2;
      p.y = 80;
      p.vx = 0; p.vy = 0;
    }
    if (c.ops.god && p.al) {
      if (p.x < 20) p.x = 20;
      if (p.x > bounds.w - 20) p.x = bounds.w - 20;
      if (p.y < 20) p.y = 20;
      if (p.y > bounds.h - 20) p.y = bounds.h - 20;
    }
    if (c.ops.turbo && p.al) {
      const dir = keyDir(c.keys || 0);
      if (dir) { p.x += dir.x * 260 * dts; p.y += dir.y * 260 * dts; }
    }
    const list = ASSISTS[gid];
    if (list) {
      for (const a of list) {
        if (c.ops.act && c.ops.act[a.id]) {
          try { a.run(st, dts, ids, frame, onInput); } catch (err) {}
        }
      }
    }
  }
}

function revive(st, game, conns) {
  const bounds = worldBounds(game);
  for (const c of conns) {
    if (!c.ops.god) continue;
    const p = st.p[String(c.pid)];
    if (p && !p.al) {
      p.al = 1;
      if (p.deathT !== undefined) p.deathT = -1;
      p.x = bounds.w / 2;
      p.y = 80;
      p.vx = 0; p.vy = 0;
    }
  }
}

function forcedWin(st, conns) {
  for (const c of conns) {
    if (!c.ops.force) continue;
    c.ops.force = 0;
    const rest = [];
    for (const k in st.p) if (Number(k) !== c.pid) rest.push(Number(k));
    rest.sort((a, b) => (st.p[String(b)].sc || 0) - (st.p[String(a)].sc || 0));
    const sc = {};
    for (const q in st.p) sc[q] = st.p[q].sc || 0;
    return { w: c.pid, reason: 'time', rank: [c.pid].concat(rest), sc };
  }
  return null;
}

module.exports = { init, keyOk, activeConns, preBots, postBots, afterTick, revive, forcedWin, ASSISTS };
