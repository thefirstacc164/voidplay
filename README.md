# VOIDPLAY

**20 multiplayer browser microgames. The firewall can't stop the fun.**

No installs, no downloads, no sign-up wall — press PLAY, share a 4-letter room
code, and go. Built for restrictive networks: one tiny Node process serving
gzipped static files and WebSockets on a single port, vanilla JS + Canvas on
the client, zero CDNs, zero bundlers.

Made with love by Step.

---

## The games

| | | | |
|---|---|---|---|
| 🧱 Tile Collapse | 🥊 Bumper Knock | 🧟 Infected | 💣 Bomb Tag |
| 🏃 Turbo Tag | 👑 King of the Hill | 💪 Juggernaut | 🎨 Color Raid |
| 🐍 Snake Pit | 🖌️ Pixel Paint | 🌀 Gravity Well | 🛸 Orbit Dodge |
| ⚡ Laser Maze | 🧗 Sky Climb | 🌋 Lava Floor | 🏎️ Neon Drift |
| 🌀 Maze Racer | 🏒 Hover Hockey | ☄️ Asteroid Storm | ⚡ Reaction Royale |

Every game runs three ways:

- **SOLO** — you plus 1–3 bots, simulated entirely in your browser
- **TWO PLAYER** — two humans on one keyboard (WASD + Space vs Arrows + Enter)
- **MULTIPLAYER** — authoritative server rooms with a shareable code

Solo and two-player modes never touch the server: the game module runs in a
local fixed-timestep loop, so a potato on school wifi can still play.

## Accounts, coins and the vault

Playing as a guest needs nothing — you get a random name and your coins are
kept on your device. The optional ACCOUNT button unlocks:

- **coins and a shop** — shapes and trails, earned by playing (win 60 / 2nd 30 / 3rd 15 / 4th 10, +10 per match)
- **trading** — swap items with anyone in your room
- **friends** — a live dock with online status, room codes, invites and quick play
- **stats** — plays and wins

Guest coins merge into your account when you log in (capped at 400 per merge).

### Where accounts live

Accounts are stored in an **encrypted blob inside this repository** — no
database service. The vault file (`db.bin` on the `vault` branch) is
AES-256-GCM encrypted with `VAULT_KEY`; passwords are scrypt-hashed *inside*
the encrypted blob, so nothing readable ever leaves the server. The server
pushes the vault through the GitHub Contents API (debounced) and pulls +
merges every 90 seconds.

Because the repo is public, the key and token never enter git — they are env
vars:

| Variable | What it is |
|---|---|
| `VAULT_KEY` | any long random string — the AES key material |
| `GH_REPO` | `owner/repo` of this repository |
| `GH_TOKEN` | a fine-grained token with read/write on Contents |
| `SESSION_SECRET` | any long random string — signs session tokens |

Without them the server falls back to a local `data/vault.json` (gitignored),
so development needs zero configuration.

## Bandwidth-friendly by design

- every asset is pre-gzipped in memory; all 20 games together are ~55 KB compressed
- games load Steam-style: the library asks *load all now* or *one by one*, and remembers your choice
- game files are versioned (`?v=`), `immutable` + ETag — cached forever, revalidated for nothing
- gameplay runs at 20 Hz with delta-compressed state (typically a few hundred bytes per tick)
- input is a 2-byte MessagePack array

## Running it

```bash
npm install
npm start            # → http://localhost:10000
```

Tests:

```bash
node test/smoke.js   # full server + protocol + accounts integration suite (needs the server running)
node test/soak.js    # simulates every game with 4 bots until it ends — checks it always terminates
```

Deploy to Render with **New + Blueprint** on this repo (see `render.yaml`).
Set the four env vars above in the dashboard to enable the GitHub vault.

## Layout

```
server/       index, rooms, accounts, vault, games loader, wire protocol
games/        20 game modules (shared by server + browser)
shared/       core helpers (physics, deltas, canvas kit) + item catalog
client/       vanilla JS: menu, library, lobby, engine, network
test/         smoke (integration) + soak (game termination)
```
