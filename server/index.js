'use strict';

/**
 * VOIDPLAY — server/index.js
 * ---------------------------------------------------------------------------
 * Single-process entry point:
 *   * serves the static client from /client on the same port
 *   * upgrades HTTP → WebSocket on that same port (works on Render.com)
 *   * routes binary frames to the room manager
 *
 *   npm start  /  node server/index.js
 *   Listens on process.env.PORT (Render injects it; defaults to 10000).
 * ---------------------------------------------------------------------------
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const net = require('./network');
const rooms = require('./rooms');

const PORT = parseInt(process.env.PORT, 10) || 10000;
const HOST = '0.0.0.0';
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// ----------------------------------------------------------------------------
// Static file server (client/)
// ----------------------------------------------------------------------------

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method not allowed');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400); return res.end('Bad request');
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (pathname === '/') pathname = '/index.html';

  // resolve + jail inside CLIENT_DIR (no traversal)
  const filePath = path.normalize(path.join(CLIENT_DIR, pathname));
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(serveStatic);

// ----------------------------------------------------------------------------
// WebSocket endpoint (same port — Render-friendly)
// ----------------------------------------------------------------------------

const wss = new WebSocketServer({ server, maxPayload: 4096 });

function handle(conn, msg) {
  if (!msg || !msg.payload) return;
  switch (msg.type) {
    case net.MSG.INPUT: {
      const p = msg.payload;
      if (!Array.isArray(p) || p.length < 2) return;
      const keys = p[0] | 0;
      const seq = p[1] | 0;
      if (!(seq >= 0)) return;
      if (seq > conn.lastSeq) conn.lastSeq = seq;   // TCP is ordered; ack = last seen
      rooms.routeInput(conn, keys & 63);
      break;
    }
    case net.MSG.ROOM: {
      rooms.dispatch(conn, msg.payload.e, msg.payload);
      break;
    }
    case net.MSG.SOCIAL: {
      const e = msg.payload.e;
      if (e === 'hello') rooms.hello(conn, msg.payload.name);
      else if (e === 'chat') rooms.chat(conn, msg.payload.t);
      else if (e === 'watch') rooms.watch(conn, msg.payload.f);
      break;
    }
    default: break;
  }
}

wss.on('connection', (ws) => {
  const conn = {
    ws,
    name: null,
    pid: null,          // 1-4 inside a room
    slot: null,
    room: null,
    lastSeq: 0,         // last input seq processed (echoed back as the ack)
    chatTimes: [],
  };
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;               // binary protocol only
    try {
      handle(conn, net.parse(data));
    } catch (err) {
      console.error('[voidplay] message handler error:', err);
    }
  });
  ws.on('close', () => rooms.onDisconnect(conn));
  ws.on('error', () => { /* close handler does the cleanup */ });
});

// Heartbeat: drop sockets that never pong (Render proxies pass pings through)
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    try { ws.ping(); } catch (err) { /* ignore */ }
  }
}, 30_000).unref();

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------

server.listen(PORT, HOST, () => {
  console.log(`[voidplay] ● VOIDPLAY live on http://${HOST}:${PORT} — the firewall can't stop the fun`);
  console.log(`[voidplay] serving ${CLIENT_DIR} + WebSocket on the same port`);
});

// Ops heartbeat log (useful on Render's dashboard)
setInterval(() => {
  const players = wss.clients.size;
  const active = [...rooms.rooms.values()].filter((r) => r.phase === 'playing').length;
  console.log(`[voidplay] stats: ${players} connection(s), ${rooms.rooms.size} room(s), ${active} in play`);
}, 60_000).unref();

process.on('SIGTERM', () => {
  console.log('[voidplay] SIGTERM — shutting down');
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});

process.on('uncaughtException', (err) => {
  console.error('[voidplay] uncaught exception:', err);
  process.exit(1);
});
