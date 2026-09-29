'use strict';

const crypto = require('crypto');
const vault = require('./vault');
const items = require('../shared/items');

const SECRET = process.env.SESSION_SECRET || process.env.VAULT_KEY || '';
const NAME_RE = /^[\w][\w -]{2,15}$/;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LOGIN_WINDOW_MS = 10000;
const LOGIN_MAX_TRIES = 5;
const CLAIM_CAP = 400;
const REWARD_CAP = 300;

const loginTimes = new Map();

function secret() {
  return SECRET ? crypto.createHash('sha256').update(SECRET).digest() : crypto.randomBytes(32);
}

let cachedSecret = SECRET ? secret() : null;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payload) {
  if (!cachedSecret) cachedSecret = secret();
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', cachedSecret).update(body).digest());
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!cachedSecret) cachedSecret = secret();
  const want = b64url(crypto.createHmac('sha256', cachedSecret).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8'));
    if (!payload || typeof payload.n !== 'string') return null;
    if (payload.x && Date.now() > payload.x) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function hashPassword(pass, salt) {
  return crypto.scryptSync(String(pass), Buffer.from(salt, 'hex'), 32, SCRYPT_OPTS).toString('hex');
}

function tooManyLogins(key) {
  const now = Date.now();
  const times = (loginTimes.get(key) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginTimes.set(key, times);
  return times.length >= LOGIN_MAX_TRIES;
}

function recordLogin(key) {
  loginTimes.get(key).push(Date.now());
}

function publicProfile(user) {
  return {
    name: user.name,
    coins: user.coins,
    items: user.items.slice(),
    shape: user.shape,
    trail: user.trail,
    stats: { plays: user.stats.plays, wins: user.stats.wins },
    friends: user.friends.slice(),
  };
}

function signup(conn, name, pass) {
  const clean = String(name || '').trim();
  if (!NAME_RE.test(clean)) return { e: 'auth', ok: 0, msg: 'Name must be 3-16 letters, numbers, spaces' };
  if (String(pass || '').length < 6) return { e: 'auth', ok: 0, msg: 'Password must be at least 6 characters' };
  if (clean.toLowerCase() === 'guest') return { e: 'auth', ok: 0, msg: 'That name is reserved' };
  const key = clean.toLowerCase();
  if (vault.get().users[key]) return { e: 'auth', ok: 0, msg: 'That name is taken' };
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    name: clean,
    salt,
    hash: hashPassword(pass, salt),
    created: Date.now(),
    updated: Date.now(),
    coins: 100,
    items: [],
    shape: 'sq',
    trail: 't0',
    stats: { plays: 0, wins: 0 },
    friends: [],
  };
  vault.mutate((d) => { d.users[key] = user; });
  conn.name = clean;
  conn.auth = key;
  const token = sign({ n: key, i: Date.now(), x: Date.now() + 1000 * 60 * 60 * 24 * 30 });
  return { e: 'auth', ok: 1, name: clean, token, profile: publicProfile(user), msg: 'Account created' };
}

function login(conn, name, pass, token) {
  let key = null;
  if (token) {
    const payload = verify(token);
    if (!payload) return { e: 'auth', ok: 0, msg: 'Session expired, log in again' };
    key = payload.n;
  } else {
    const clean = String(name || '').trim();
    if (!NAME_RE.test(clean)) return { e: 'auth', ok: 0, msg: 'Wrong name or password' };
    key = clean.toLowerCase();
  }
  if (tooManyLogins(key)) return { e: 'auth', ok: 0, msg: 'Too many attempts, wait a bit' };
  recordLogin(key);
  const user = vault.get().users[key];
  if (!user) return { e: 'auth', ok: 0, msg: 'Wrong name or password' };
  if (!token) {
    const hash = hashPassword(pass, user.salt);
    const a = Buffer.from(hash);
    const b = Buffer.from(user.hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { e: 'auth', ok: 0, msg: 'Wrong name or password' };
    }
  }
  conn.name = user.name;
  conn.auth = key;
  const fresh = sign({ n: key, i: Date.now(), x: Date.now() + 1000 * 60 * 60 * 24 * 30 });
  return { e: 'auth', ok: 1, name: user.name, token: fresh, profile: publicProfile(user), msg: 'Welcome back' };
}

function logout(conn) {
  conn.name = guestName(conn);
  conn.auth = null;
  return { e: 'logout', ok: 1, guest: conn.name };
}

function guestName(conn) {
  if (conn.guestName) return conn.guestName;
  let n = '';
  for (let i = 0; i < 4; i++) n += ((Math.random() * 10) | 0).toString();
  conn.guestName = 'Guest-' + n;
  return conn.guestName;
}

function profileOf(conn) {
  if (!conn.auth) return null;
  return vault.get().users[conn.auth] || null;
}

function ownKey(kind, id) {
  return (kind === 'trail' ? 't:' : 's:') + id;
}

function buy(conn, kind, id) {
  const user = profileOf(conn);
  if (!user) return { e: 'buy', ok: 0, msg: 'Log in first' };
  const it = items.find(kind === 'trail' ? 'trail' : 'shape', id);
  if (!it || it.price <= 0) return { e: 'buy', ok: 0, msg: 'That is not for sale' };
  if (user.items.includes(ownKey(kind, id))) return { e: 'buy', ok: 0, msg: 'Already owned' };
  if (user.coins < it.price) return { e: 'buy', ok: 0, msg: 'Not enough coins' };
  vault.mutate((d) => {
    const u = d.users[conn.auth];
    u.coins -= it.price;
    u.items.push(ownKey(kind, id));
    u.updated = Date.now();
  });
  return { e: 'buy', ok: 1, profile: publicProfile(profileOf(conn)) };
}

function equip(conn, kind, id) {
  const user = profileOf(conn);
  if (!user) return { e: 'equip', ok: 0, msg: 'Log in first' };
  const it = items.find(kind === 'trail' ? 'trail' : 'shape', id);
  if (!it) return { e: 'equip', ok: 0, msg: 'Unknown item' };
  if (it.price > 0 && !user.items.includes(ownKey(kind, id))) return { e: 'equip', ok: 0, msg: 'You do not own that' };
  vault.mutate((d) => {
    const u = d.users[conn.auth];
    if (kind === 'trail') u.trail = id; else u.shape = id;
    u.updated = Date.now();
  });
  return { e: 'equip', ok: 1, profile: publicProfile(profileOf(conn)) };
}

function claim(conn, coins) {
  const user = profileOf(conn);
  if (!user) return { e: 'claim', ok: 0 };
  const amount = Math.max(0, Math.min(CLAIM_CAP, Math.round(Number(coins) || 0)));
  vault.mutate((d) => {
    const u = d.users[conn.auth];
    u.coins += amount;
    u.updated = Date.now();
  });
  return { e: 'claim', ok: 1, added: amount, profile: publicProfile(profileOf(conn)) };
}

function friendAdd(conn, rawName) {
  const user = profileOf(conn);
  if (!user) return { e: 'friends', ok: 0, msg: 'Log in first' };
  const clean = String(rawName || '').trim();
  if (!NAME_RE.test(clean)) return { e: 'friends', ok: 0, msg: 'Invalid name' };
  const key = clean.toLowerCase();
  if (key === conn.auth) return { e: 'friends', ok: 0, msg: 'That is you' };
  if (!vault.get().users[key]) return { e: 'friends', ok: 0, msg: 'No such player' };
  if (user.friends.includes(key)) return { e: 'friends', ok: 0, msg: 'Already friends' };
  vault.mutate((d) => {
    d.users[conn.auth].friends.push(key);
    d.users[conn.auth].updated = Date.now();
    if (!d.users[key].friends.includes(conn.auth)) d.users[key].friends.push(conn.auth);
  });
  return { e: 'friends', ok: 1, profile: publicProfile(profileOf(conn)) };
}

function friendDel(conn, rawName) {
  const user = profileOf(conn);
  if (!user) return { e: 'friends', ok: 0, msg: 'Log in first' };
  const key = String(rawName || '').trim().toLowerCase();
  vault.mutate((d) => {
    const u = d.users[conn.auth];
    u.friends = u.friends.filter((f) => f !== key);
    u.updated = Date.now();
    if (d.users[key]) d.users[key].friends = d.users[key].friends.filter((f) => f !== conn.auth);
  });
  return { e: 'friends', ok: 1, profile: publicProfile(profileOf(conn)) };
}

function top() {
  const users = vault.get().users;
  const list = [];
  for (const key of Object.keys(users)) {
    const u = users[key];
    if (u.stats && u.stats.plays > 0) list.push({ n: u.name, p: u.stats.plays, w: u.stats.wins || 0 });
  }
  list.sort((a, b) => (b.w - a.w) || (b.p - a.p));
  return list.slice(0, 10);
}

function credit(conn, coins, won) {
  const user = profileOf(conn);
  if (!user) return null;
  const amount = Math.max(0, Math.min(REWARD_CAP, Math.round(Number(coins) || 0)));
  vault.mutate((d) => {
    const u = d.users[conn.auth];
    u.coins += amount;
    u.stats.plays += 1;
    if (won) u.stats.wins += 1;
    u.updated = Date.now();
  });
  return { e: 'reward', coins: amount, total: profileOf(conn).coins, won: won ? 1 : 0 };
}

module.exports = {
  signup,
  login,
  logout,
  guestName,
  profileOf,
  publicProfile,
  buy,
  equip,
  claim,
  friendAdd,
  friendDel,
  credit,
  top,
};
