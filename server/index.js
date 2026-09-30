'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const net = require('./network');
const rooms = require('./rooms');
const accounts = require('./accounts');
const vault = require('./vault');
const srvops = require('./ops');

const VERSION = '1.1.0';
const games = require('./games');

const PORT = parseInt(process.env.PORT, 10) || 10000;
const HOST = '0.0.0.0';
const ROOT = path.join(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const SHARED_DIR = path.join(ROOT, 'shared');
const GAMES_DIR = path.join(ROOT, 'games');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const assets = new Map();

function loadDir(dir, prefix) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.js') && !file.endsWith('.css') && !file.endsWith('.html')) continue;
    const full = path.join(dir, file);
    const raw = fs.readFileSync(full);
    const etag = '"' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16) + '"';
    assets.set(prefix + file, {
      raw,
      gz: zlib.gzipSync(raw, { level: 9 }),
      etag,
      mime: MIME[path.extname(file)] || 'application/octet-stream',
    });
  }
}

loadDir(CLIENT_DIR, '/client/');
loadDir(SHARED_DIR, '/shared/');
loadDir(GAMES_DIR, '/games/');

let opsBundle = null;
try { opsBundle = fs.readFileSync(path.join(ROOT, 'private', 'ops.js')); } catch (err) {}
const opsKeyHash = process.env.PSWRD_PSWRD
  ? crypto.createHash('sha256').update(String(process.env.PSWRD_PSWRD).trim()).digest()
  : null;
srvops.init(opsKeyHash);
const opsFails = new Map();
const OPS_MAX_FAILS = 5;
const OPS_LOCK_MS = 15 * 60 * 1000;

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function notAllowed(res) {
  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method not allowed');
}

function readBody(req, cap) {
  return new Promise((resolve) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) { req.destroy(); resolve(null); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', () => resolve(null));
  });
}

function keyMatches(key) {
  if (!opsKeyHash) return false;
  const hash = key ? crypto.createHash('sha256').update(String(key).trim()).digest() : null;
  return !!hash && hash.length === opsKeyHash.length &&
    crypto.timingSafeEqual(hash, opsKeyHash);
}

async function handleOps(req, res, ip) {
  if (!opsBundle || !opsKeyHash) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    return res.end('Service unavailable');
  }
  const rec = opsFails.get(ip);
  if (rec && rec.lockedUntil > Date.now()) {
    const wait = Math.max(1, Math.ceil((rec.lockedUntil - Date.now()) / 1000));
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': String(wait) });
    return res.end('Too many requests');
  }
  const raw = await readBody(req, 4096);
  if (!raw) return notFound(res);
  let key = null;
  try { key = JSON.parse(raw.toString('utf8')).k; } catch (err) { key = null; }
  if (!keyMatches(key)) {
    const n = (rec ? rec.fails : 0) + 1;
    opsFails.set(ip, { fails: n, lockedUntil: n >= OPS_MAX_FAILS ? Date.now() + OPS_LOCK_MS : 0 });
    if (opsFails.size > 5000) opsFails.clear();
    return notAllowed(res);
  }
  opsFails.set(ip, { fails: 0, lockedUntil: 0 });
  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': opsBundle.length,
  });
  res.end(req.method === 'HEAD' ? undefined : opsBundle);
}

async function handleAdm(req, res, ip) {
  if (!opsKeyHash) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    return res.end('Service unavailable');
  }
  const rec = opsFails.get(ip);
  if (rec && rec.lockedUntil > Date.now()) {
    const wait = Math.max(1, Math.ceil((rec.lockedUntil - Date.now()) / 1000));
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': String(wait) });
    return res.end('Too many requests');
  }
  const raw = await readBody(req, 16384);
  if (!raw) return notFound(res);
  let p = null;
  try { p = JSON.parse(raw.toString('utf8')); } catch (err) { p = null; }
  if (!keyMatches(p && p.k)) {
    const n = (rec ? rec.fails : 0) + 1;
    opsFails.set(ip, { fails: n, lockedUntil: n >= OPS_MAX_FAILS ? Date.now() + OPS_LOCK_MS : 0 });
    if (opsFails.size > 5000) opsFails.clear();
    return notAllowed(res);
  }
  opsFails.set(ip, { fails: 0, lockedUntil: 0 });
  let reply;
  try {
    reply = await accounts.admin(p.op, p);
  } catch (err) {
    reply = { ok: 0, msg: 'Server error' };
  }
  const body = JSON.stringify(reply);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function acceptsGzip(req) {
  return String(req.headers['accept-encoding'] || '').includes('gzip');
}

function serveAsset(req, res, key, immutableAllowed) {
  const asset = assets.get(key);
  if (!asset) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304, { ETag: asset.etag });
    return res.end();
  }
  const versioned = immutableAllowed && /[?&]v=/.test(req.url);
  const headers = {
    'Content-Type': asset.mime,
    ETag: asset.etag,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  let body = asset.raw;
  if (acceptsGzip(req)) {
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = asset.gz.length;
    body = asset.gz;
  } else {
    headers['Content-Length'] = asset.raw.length;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer((req, res) => {
  res.setHeader('x-vp', VERSION);
  const ip = req.socket.remoteAddress || 'unknown';
  if (req.method === 'POST') {
    let opPath = null;
    try { opPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (err) { opPath = null; }
    if (opPath === '/x/ops') {
      handleOps(req, res, ip).catch(() => { try { notAllowed(res); } catch (err) {} });
      return;
    }
    if (opPath === '/x/adm') {
      handleAdm(req, res, ip).catch(() => { try { notAllowed(res); } catch (err) {} });
      return;
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method not allowed');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (pathname === '/games.json') {
    const body = Buffer.from(games.manifestJson);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Length': body.length,
    };
    if (acceptsGzip(req)) {
      const gz = zlib.gzipSync(body, { level: 9 });
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = gz.length;
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : gz);
    }
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (pathname === '/') {
    return serveAsset(req, res, '/client/index.html', false);
  }
  if (pathname.startsWith('/client/')) {
    const key = path.normalize(pathname).replace(/\\/g, '/');
    if (!assets.has(key)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    return serveAsset(req, res, key, true);
  }
  if (pathname.startsWith('/shared/') || pathname.startsWith('/games/')) {
    const key = path.normalize(pathname).replace(/\\/g, '/');
    if (!assets.has(key)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    return serveAsset(req, res, key, true);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });

function applyAuth(conn, reply) {
  if (reply && reply.ok) {
    presenceRename(conn, reply.name);
    if (conn.room) conn.room.updateAll();
  }
  net.send(conn.ws, net.MSG.SOCIAL, reply);
}

function presenceRename(conn, name) {
  rooms.presence.register(conn, name);
}

function handleSocial(conn, p) {
  switch (p.e) {
    case 'signup':
      accounts.signup(conn, p.n, p.p)
        .then((reply) => applyAuth(conn, reply))
        .catch(() => net.send(conn.ws, net.MSG.SOCIAL, { e: 'auth', ok: 0, msg: 'Server busy, try again' }));
      break;
    case 'login':
      accounts.login(conn, p.n, p.p, p.token)
        .then((reply) => applyAuth(conn, reply))
        .catch(() => net.send(conn.ws, net.MSG.SOCIAL, { e: 'auth', ok: 0, msg: 'Server busy, try again' }));
      break;
    case 'logout': {
      const reply = accounts.logout(conn);
      presenceRename(conn, conn.name);
      if (conn.room) conn.room.updateAll();
      net.send(conn.ws, net.MSG.SOCIAL, reply);
      break;
    }
    case 'buy': net.send(conn.ws, net.MSG.SOCIAL, accounts.buy(conn, p.k, p.id)); break;
    case 'equip': net.send(conn.ws, net.MSG.SOCIAL, accounts.equip(conn, p.k, p.id)); break;
    case 'claim': net.send(conn.ws, net.MSG.SOCIAL, accounts.claim(conn, p.c)); break;
    case 'fadd': net.send(conn.ws, net.MSG.SOCIAL, accounts.friendAdd(conn, p.n)); break;
    case 'fdel': net.send(conn.ws, net.MSG.SOCIAL, accounts.friendDel(conn, p.n)); break;
    case 'top': net.send(conn.ws, net.MSG.SOCIAL, { e: 'top', list: accounts.top() }); break;
    case 'invite': rooms.invite(conn, p.to, p.g); break;
    case 'chat': rooms.chat(conn, p.t); break;
    case 'watch': rooms.watch(conn, p.f); break;
    case 'ops': {
      if (!opsKeyHash) break;
      if (!srvops.keyOk(p.k)) {
        conn.opsTries = (conn.opsTries || 0) + 1;
        break;
      }
      conn.opsTries = 0;
      if (!conn.ops) conn.ops = { on: true, god: 0, turbo: 0, auto: 0, freeze: 0, force: 0, act: {} };
      if (p.o) {
        if (p.o.god !== undefined) conn.ops.god = p.o.god ? 1 : 0;
        if (p.o.turbo !== undefined) conn.ops.turbo = p.o.turbo ? 1 : 0;
        if (p.o.auto !== undefined) conn.ops.auto = p.o.auto ? 1 : 0;
        if (p.o.freeze !== undefined) conn.ops.freeze = p.o.freeze ? 1 : 0;
        if (p.o.skill !== undefined) conn.ops.skill = Math.max(1, Math.min(10, Math.round(p.o.skill)));
      }
      if (p.act) {
        for (const k of Object.keys(p.act)) conn.ops.act[k] = p.act[k] ? 1 : 0;
      }
      if (p.win) conn.ops.force = 1;
      if (p.off) { conn.ops = null; break; }
      net.send(conn.ws, net.MSG.SOCIAL, {
        e: 'opsack',
        st: { god: conn.ops.god, turbo: conn.ops.turbo, auto: conn.ops.auto, freeze: conn.ops.freeze, skill: conn.ops.skill || 7, act: conn.ops.act },
      });
      break;
    }
    default: break;
  }
}

function handle(conn, msg) {
  if (!msg || !msg.payload) return;
  switch (msg.type) {
    case net.MSG.INPUT: {
      const p = msg.payload;
      if (!Array.isArray(p) || p.length < 2) return;
      const keys = p[0] | 0;
      const seq = p[1] | 0;
      if (!(seq >= 0)) return;
      if (seq > conn.lastSeq) conn.lastSeq = seq;
      conn.keys = keys & 63;
      rooms.routeInput(conn, keys & 63);
      break;
    }
    case net.MSG.ROOM: {
      rooms.dispatch(conn, msg.payload.e, msg.payload);
      break;
    }
    case net.MSG.SOCIAL: {
      try {
        handleSocial(conn, msg.payload);
      } catch (err) {
        console.error('[voidplay] social handler error:', err);
      }
      break;
    }
    default: break;
  }
}

wss.on('connection', (ws) => {
  const conn = {
    ws,
    name: null,
    guest: true,
    auth: null,
    pid: null,
    room: null,
    lastSeq: 0,
    chatTimes: [],
  };
  conn.name = accounts.guestName(conn);
  rooms.presence.register(conn, conn.name);
  net.send(ws, net.MSG.SOCIAL, { e: 'hello', name: conn.name, durable: vault.remote ? 1 : 0 });
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    try {
      handle(conn, net.parse(data));
    } catch (err) {
      console.error('[voidplay] message handler error:', err);
    }
  });
  ws.on('close', () => rooms.onDisconnect(conn));
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    try { ws.ping(); } catch (err) {}
  }
}, 30000).unref();

vault.start();

server.listen(PORT, HOST, () => {
  console.log("[voidplay] VOIDPLAY live on http://" + HOST + ":" + PORT + " - the firewall can't stop the fun");
  console.log('[voidplay] ' + games.manifest.length + ' games loaded, vault ' + (vault.remote ? 'synced to github' : 'in local mode'));
});

setInterval(() => {
  const players = wss.clients.size;
  const active = [...rooms.rooms.values()].filter((r) => r.phase === 'playing').length;
  console.log('[voidplay] stats: ' + players + ' connection(s), ' + rooms.rooms.size + ' room(s), ' + active + ' in play');
}, 60000).unref();

process.on('SIGTERM', () => {
  console.log('[voidplay] SIGTERM - shutting down');
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});

process.on('uncaughtException', (err) => {
  console.error('[voidplay] uncaught exception:', err);
  process.exit(1);
});
