'use strict';

/**
 * VOIDPLAY — server/games/tileCollapse.js
 * ---------------------------------------------------------------------------
 * "Tile Collapse" — last one standing on a crumbling grid.
 *
 *   * 12x10 grid of tiles inside the shared 800x600 arena.
 *   * Players hop tile-to-tile (grid movement — cheap to network, easy
 *     to predict on the client).
 *   * 0.8s after a player steps OFF a tile it CRACKS; 0.5s later it FALLS.
 *   * Standing on a tile when it falls (or landing on a fallen tile) =
 *     eliminated into the void.
 *   * Moving onto a fallen tile is blocked.
 *   * Last player standing wins. If everyone falls, the void wins.
 *   * Anti-stall: after 45s ("sudden death") every remaining intact tile
 *     begins decaying on a staggered timer, so the match always ends.
 *
 * Exports the standard VOIDPLAY game interface:
 *   init(players) → state
 *   onInput(state, playerId, input)        (state passed explicitly so one
 *   tick(state, deltaTime)                  module instance can serve many
 *   getState(state, lastSentState)          rooms concurrently — modules are
 *   checkWin(state)                         stateless)
 * plus the optional onPlayerLeft(state, pid) hook.
 * ---------------------------------------------------------------------------
 */

// --- Arena constants (mirrored to the client via CONFIG.grid) --------------
const COLS = 12;
const ROWS = 10;
const CELL_W = 60;                    // 12 * 60  = 720
const CELL_H = 56;                    // 10 * 56  = 560
const OFF_X = 40;                     // (800 - 720) / 2
const OFF_Y = 20;                     // (600 - 560) / 2

const MOVE_MS = 150;                  // one hop
const CRACK_AFTER_MS = 800;           // after stepping off a tile
const FALL_AFTER_CRACK_MS = 500;      // crack → fall
const SUDDEN_DEATH_MS = 45000;        // every intact tile starts decaying
const DURATION_MS = 90000;            // hard cap (sudden death ends first)

const DX = [0, 0, -1, 1];             // up, down, left, right
const DY = [-1, 1, 0, 0];

const SPAWNS = [                      // by player slot (1-4)
  [1, 1],
  [10, 1],
  [1, 8],
  [10, 8],
];

const CONFIG = {
  id: 'tileCollapse',
  name: 'Tile Collapse',
  icon: '🧱',
  duration: DURATION_MS / 1000,       // seconds (lobby timer display)
  minPlayers: 2,
  maxPlayers: 4,
  description: 'Hop across a grid of neon tiles that crack and fall behind you. Outlive everyone else.',
  instructions: 'WASD / Arrow keys to hop. Tiles crack 0.8s after you leave them, then fall. Last one standing wins.',
  grid: {
    cols: COLS, rows: ROWS, cellW: CELL_W, cellH: CELL_H, offX: OFF_X, offY: OFF_Y,
    moveMs: MOVE_MS, crackMs: CRACK_AFTER_MS, fallMs: FALL_AFTER_CRACK_MS,
    suddenDeathMs: SUDDEN_DEATH_MS,
  },
};

// --- Helpers ----------------------------------------------------------------

function idx(gx, gy) { return gy * COLS + gx; }
function inBounds(gx, gy) { return gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS; }
function centerX(gx) { return OFF_X + (gx + 0.5) * CELL_W; }
function centerY(gy) { return OFF_Y + (gy + 0.5) * CELL_H; }

/** Same priority order as the client's prediction — keep them in sync. */
function dirFromKeys(k) {
  if (k & 1) return 0; // up
  if (k & 2) return 1; // down
  if (k & 4) return 2; // left
  if (k & 8) return 3; // right
  return -1;
}

// --- Game interface ----------------------------------------------------------

/** init(players) → fresh game state. players = [{ i: pid, n: name, s: slot }] */
function init(players) {
  const state = {
    t: 0,                // elapsed ms
    ph: 0,               // 0 = normal, 1 = sudden death
    tiles: new Array(COLS * ROWS).fill(0),   // 0 intact, 1 cracked, 2 fallen
    decayAt: new Array(COLS * ROWS).fill(0), // ms-time a tile will crack (0 = none)
    fallAt: new Array(COLS * ROWS).fill(0),  // ms-time a cracked tile will fall
    players: {},
  };
  for (const p of players) {
    const [gx, gy] = SPAWNS[(p.s - 1) % 4];
    state.players[String(p.i)] = {
      name: p.n, slot: p.s,
      x: centerX(gx), y: centerY(gy),
      gx, gy, d: -1, m: 0,      // d = facing dir, m = 1 while mid-hop
      moveStart: 0,             // state.t when the current hop began
      k: 0,                     // last input key bitmask
      al: 1,                    // alive
      deathT: -1,
    };
  }
  return state;
}

/** onInput — just records the latest key bitmask; movement is applied in tick. */
function onInput(state, playerId, input) {
  const p = state.players[String(playerId)];
  if (p && p.al) p.k = input.k & 63;
}

/** Optional hook: a player disconnected mid-match — counts as a fall. */
function onPlayerLeft(state, playerId) {
  const p = state.players[String(playerId)];
  if (p && p.al) {
    p.al = 0;
    p.deathT = state.t;
    p.m = 0;
  }
}

function tick(state, dt) {
  state.t += dt;

  // --- sudden death: everything left starts decaying, staggered -------------
  if (state.ph === 0 && state.t >= SUDDEN_DEATH_MS) {
    state.ph = 1;
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] === 0 && !state.decayAt[i]) {
        state.decayAt[i] = state.t + 200 + Math.random() * 6000;
      }
    }
  }

  // --- tile lifecycle --------------------------------------------------------
  for (let i = 0; i < state.tiles.length; i++) {
    const ph = state.tiles[i];
    if (ph === 0 && state.decayAt[i] && state.t >= state.decayAt[i]) {
      state.tiles[i] = 1;
      state.fallAt[i] = state.decayAt[i] + FALL_AFTER_CRACK_MS;
    } else if (ph === 1 && state.t >= state.fallAt[i]) {
      state.tiles[i] = 2;
      // anyone standing on it falls into the void
      for (const pid in state.players) {
        const p = state.players[pid];
        if (p.al && !p.m && idx(p.gx, p.gy) === i) die(state, p);
      }
    }
  }

  // --- players ---------------------------------------------------------------
  for (const pid in state.players) {
    const p = state.players[pid];
    if (!p.al) continue;

    // advance an in-progress hop
    if (p.m) {
      const elapsed = state.t - p.moveStart;
      if (elapsed >= MOVE_MS) {
        const fromIdx = idx(p.gx, p.gy);
        p.gx += DX[p.d];
        p.gy += DY[p.d];
        p.m = 0;
        p.x = centerX(p.gx);
        p.y = centerY(p.gy);
        // the tile we just left starts decaying (first departure only)
        if (state.tiles[fromIdx] === 0 && !state.decayAt[fromIdx]) {
          state.decayAt[fromIdx] = state.t + CRACK_AFTER_MS;
        }
        // landed on a tile that fell mid-flight → void
        if (state.tiles[idx(p.gx, p.gy)] === 2) die(state, p);
      } else {
        const t = elapsed / MOVE_MS;
        p.x = centerX(p.gx) + (centerX(p.gx + DX[p.d]) - centerX(p.gx)) * t;
        p.y = centerY(p.gy) + (centerY(p.gy + DY[p.d]) - centerY(p.gy)) * t;
      }
    }

    // start a new hop if idle and a direction is held
    if (p.al && !p.m) {
      const dir = dirFromKeys(p.k);
      if (dir >= 0) {
        p.d = dir;
        const nx = p.gx + DX[dir];
        const ny = p.gy + DY[dir];
        if (inBounds(nx, ny) && state.tiles[idx(nx, ny)] !== 2) {
          p.m = 1;
          p.moveStart = state.t;
        }
      }
    }
  }
}

function die(state, p) {
  p.al = 0;
  p.deathT = state.t;
  p.m = 0;
  p.x = centerX(p.gx);
  p.y = centerY(p.gy);
}

/** checkWin → null while the match continues, else a result object. */
function checkWin(state) {
  const alive = [];
  for (const pid in state.players) {
    if (state.players[pid].al) alive.push(Number(pid));
  }
  if (alive.length >= 2) {
    if (state.t < DURATION_MS) return null;
    return { w: null, reason: 'timeout', rank: rank(state) }; // safety net
  }
  if (alive.length === 1) {
    return { w: alive[0], reason: 'last-standing', rank: rank(state) };
  }
  return { w: null, reason: 'void', rank: rank(state) };
}

/** Ranking: winner first, then whoever survived longest. */
function rank(state) {
  const entries = Object.keys(state.players).map(Number);
  const winner = entries.filter((pid) => state.players[pid].al);
  const dead = entries.filter((pid) => !state.players[pid].al);
  dead.sort((a, b) => state.players[b].deathT - state.players[a].deathT);
  return winner.concat(dead);
}

/** Public (network) view of one player. */
function pub(p) {
  return {
    x: Math.round(p.x), y: Math.round(p.y),
    gx: p.gx, gy: p.gy, d: p.d, m: p.m, al: p.al,
  };
}

/**
 * getState(state, lastSentState)
 *   lastSentState === null → full snapshot (new viewer / resync)
 *   otherwise              → only what changed since the last broadcast
 * Wire shapes:
 *   full  { t, ph, tiles: [phase*120], p: { pid: {x,y,gx,gy,d,m,al} } }
 *   delta { t, [ph], [tl: idx,phase,...flat pairs], [p: { pid: {changed}}] }
 */
function getState(state, last) {
  if (!last) {
    const p = {};
    for (const pid in state.players) p[pid] = pub(state.players[pid]);
    return { t: Math.round(state.t), ph: state.ph, tiles: state.tiles.slice(), p };
  }

  const d = { t: Math.round(state.t) };
  if (state.ph !== last.ph) d.ph = state.ph;

  const tl = [];
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] !== last.tiles[i]) tl.push(i, state.tiles[i]);
  }
  if (tl.length) d.tl = tl;

  const pd = {};
  for (const pid in state.players) {
    const a = state.players[pid];
    const b = last.players[pid];
    if (!b) { pd[pid] = pub(a); continue; }
    const f = {};
    if (Math.round(a.x) !== Math.round(b.x)) f.x = Math.round(a.x);
    if (Math.round(a.y) !== Math.round(b.y)) f.y = Math.round(a.y);
    if (a.gx !== b.gx) f.gx = a.gx;
    if (a.gy !== b.gy) f.gy = a.gy;
    if (a.d !== b.d) f.d = a.d;
    if (a.m !== b.m) f.m = a.m;
    if (a.al !== b.al) f.al = a.al;
    if (Object.keys(f).length) pd[pid] = f;
  }
  if (Object.keys(pd).length) d.p = pd;

  return d;
}

module.exports = { CONFIG, init, onInput, onPlayerLeft, tick, getState, checkWin };
