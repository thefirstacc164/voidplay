'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'games');
const ASSET_VERSION = String(fs.statSync(path.join(ROOT, 'package.json')).mtimeMs | 0);

const registry = {};
const manifest = [];

for (const file of fs.readdirSync(GAMES_DIR).sort()) {
  if (!file.endsWith('.js')) continue;
  const mod = require(path.join(GAMES_DIR, file));
  const cfg = mod.CONFIG;
  if (!cfg || !cfg.id) continue;
  registry[cfg.id] = mod;
  const src = fs.readFileSync(path.join(GAMES_DIR, file));
  manifest.push({
    id: cfg.id,
    name: cfg.name,
    icon: cfg.icon,
    desc: cfg.description,
    instr: cfg.instructions,
    min: cfg.minPlayers,
    max: cfg.maxPlayers,
    size: src.length,
    gzip: zlib.gzipSync(src, { level: 9 }).length,
  });
}

const manifestJson = JSON.stringify({ v: ASSET_VERSION, games: manifest });

module.exports = { registry, manifest, manifestJson, ASSET_VERSION };
