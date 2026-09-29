# VOIDPLAY

**Multiplayer browser microgames. The firewall can't stop the fun.**

No installs, no downloads, no accounts — share a 4-letter room code and play.
Built for restrictive networks: one tiny Node process serving static files and
WebSockets on a single port, vanilla JS + Canvas on the client, zero CDNs,
zero bundlers.

**Phase 1 (this build):** authoritative WebSocket server, room system, full
lobby UI, friend presence, and the first game — **Tile Collapse**.

---

## Quick start

```bash
npm install
npm start          # → http://localhost:10000
```

Open the URL in two browser tabs (or two machines), enter a username in each,
create a room in one tab, join with the code in the other, and START.

Run the integration test (spins up the server, simulates a full 2-player
match, checks the wire protocol and bandwidth):

```bash
npm test
```

## Playing

- **Create a room** → you're the host → pick a game → **START**
- Others **join with the 4-letter code** (consonant-vowel pattern: `BOKU`, `LAKE`, `FUME`…)
- Up to 4 players · room dies 30s after everyone leaves
- **Move:** WASD / Arrow keys · **ACTION1:** Space · **ACTION2:** Shift · **ESC:** leave overlay
- The game grid shows 20 planned games; Tile Collapse is live, the rest unlock in later phases.

### Tile Collapse 🧱
Hop between tiles on a 12×10 grid. A tile cracks 0.8s after you step off it
and falls 0.5s later. Fall with it and you're out. Last one standing wins.
After 45s, sudden death: every remaining tile starts decaying, so nobody can
camp forever.

## Deploying to Render.com

The repo ships a [`render.yaml`](render.yaml) (Blueprint deploys), or create a
**Web Service** manually:

| Field | Value |
|---|---|
| Language | Node |
| Branch | `main` |
| Root Directory | *(leave blank)* |
| Build Command | `npm install` |
| Start Command | `node server/index.js` |
| Instance Type | Free |
| Environment Variables | none needed |

Render injects `PORT` automatically — the server listens on
`process.env.PORT || 10000`, bound to `0.0.0.0`, and serves HTTP + WebSocket
upgrades on that same port.

**Free-tier notes:** the instance spins down after idle periods (first hit
after that takes ~30-60s to cold-start, and all in-memory rooms are lost —
there is no database by design). Active WebSocket traffic keeps it awake.

## Architecture

```
server/
  index.js        HTTP static server + WS upgrade on one port, message routing
  rooms.js        Room create/join/codes/lifecycle, 20Hz game loops, presence
  network.js      Binary framing + MessagePack (msgpackr)
  games/
    index.js      Game registry
    tileCollapse.js  Server simulation (init/onInput/tick/getState/checkWin)
client/
  index.html      Single-page app: title → menu → room → game → results
  lobby.js        Screens, room UI, game grid, friends, chat, results
  engine.js       60fps Canvas loop, interpolation, prediction, particles, HUD
  network.js      WebSocket client + compact MessagePack codec (no deps)
  games/
    tileCollapse.js  Renderer + client-side prediction
  style.css       Neon minimalist dark theme
render.yaml       Render.com blueprint
```

### Networking

- **Server is authoritative** — 20 Hz (50 ms) fixed tick per room.
- **Binary frames only**: `[msgType: 1 byte][MessagePack payload]`
  - `0x01` input (c→s): `[keysBitmask, seq]` — ~4 bytes, 20×/sec
  - `0x02` state (s→c): `{ ack, full?, delta }` — delta-compressed, ~1-4 KB/s
  - `0x03` room events (join/leave/pick/start/end/again/lobby)
  - `0x04` social (chat, hello, friend presence)
- **Input bitmask:** UP=1 DOWN=2 LEFT=4 RIGHT=8 ACTION1=16 ACTION2=32
- **Delta compression:** each broadcast only contains properties that changed
  since the last one (tiles go out as flat `index,phase` pairs).
- **Client renders at 60fps**, interpolating other players 100ms in the past.
- **Client-side prediction:** your own hops apply instantly; the server
  confirms or corrects (input seqs are tagged so late server states are
  recognised as "catching up", not desync).
- **Bandwidth budget:** measured ~1-2 KB/s per player during a 2-player match
  (target: < 5 KB/s).

## Roadmap

1. ✅ **Phase 1** — server, rooms, lobby, Tile Collapse *(you are here)*
2. ⬜ **Phase 2** — Neon Drift, Bumper Knock, Reaction Royale
3. ⬜ **Phase 3** — friend invites & accounts
4. ⬜ **Phase 4** — remaining 16 games
5. ⬜ **Phase 5** — sound, screen shake polish, mobile touch

## Notes & limits (phase 1)

- All state lives in server memory (by design — no database yet). A restart
  or free-tier spin-down wipes rooms.
- Usernames aren't unique yet; presence is name-based. Accounts come later.
- Reconnecting mid-match rejoin isn't supported (disconnecting during a match
  eliminates you); you can rejoin a room during lobby/results within the
  30s empty-room window.
