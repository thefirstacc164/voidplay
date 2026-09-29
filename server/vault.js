'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const VAULT_KEY = process.env.VAULT_KEY || '';
const GH_REPO = process.env.GH_REPO || '';
const GH_TOKEN = process.env.GH_TOKEN || '';
const BRANCH = 'vault';
const FILE = 'db.bin';
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_FILE = path.join(DATA_DIR, 'vault.json');
const PUSH_DEBOUNCE_MS = 4000;
const PULL_EVERY_MS = 90000;

const remote = VAULT_KEY && GH_REPO && GH_TOKEN;

let data = { users: {} };
let remoteSha = null;
let pushTimer = null;
let pullTimer = null;
let lastPullAt = 0;
let busy = false;

function keyBuf() {
  return crypto.createHash('sha256').update(VAULT_KEY).digest();
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBuf(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decrypt(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  if (buf.length < 29) throw new Error('short blob');
  const d = crypto.createDecipheriv('aes-256-gcm', keyBuf(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}

function ghReq(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GH_REPO}/${apiPath}`,
      method,
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'voidplay-vault',
        'Content-Type': 'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0,
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('github timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function ensureBranch() {
  const r = await ghReq('GET', `git/ref/heads/${BRANCH}`);
  if (r.status === 200) return;
  const main = await ghReq('GET', 'git/ref/heads/main');
  if (main.status !== 200) throw new Error('no main branch');
  const sha = JSON.parse(main.body).object.sha;
  await ghReq('POST', 'git/refs', { ref: `refs/heads/${BRANCH}`, sha });
}

async function pullRemote() {
  if (!remote || busy) return;
  busy = true;
  try {
    const r = await ghReq('GET', `contents/${FILE}?ref=${BRANCH}&t=${Date.now()}`);
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      remoteSha = j.sha;
      mergeData(decrypt(j.content));
    } else if (r.status === 404) {
      await ensureBranch();
      remoteSha = null;
    }
    lastPullAt = Date.now();
  } catch (err) {
    console.error('[vault] pull failed:', err.message);
  } finally {
    busy = false;
  }
}

async function pushRemote() {
  if (!remote || busy) return;
  busy = true;
  try {
    await ensureBranch();
    const content = encrypt(data);
    const body = {
      message: `vault sync ${new Date().toISOString()}`,
      content,
      branch: BRANCH,
    };
    if (remoteSha) body.sha = remoteSha;
    const r = await ghReq('PUT', `contents/${FILE}`, body);
    if (r.status === 200 || r.status === 201) {
      remoteSha = JSON.parse(r.body).content.sha;
    } else if (r.status === 409 || r.status === 422) {
      await pullRemote();
    }
  } catch (err) {
    console.error('[vault] push failed:', err.message);
  } finally {
    busy = false;
  }
}

function mergeData(incoming) {
  if (!incoming || typeof incoming !== 'object' || !incoming.users) return;
  for (const key of Object.keys(incoming.users)) {
    const mine = data.users[key];
    const theirs = incoming.users[key];
    if (!mine || (theirs.updated || 0) > (mine.updated || 0)) data.users[key] = theirs;
  }
}

function saveLocal() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(data));
  } catch (err) {
    console.error('[vault] local save failed:', err.message);
  }
}

function loadLocal() {
  try {
    if (fs.existsSync(LOCAL_FILE)) data = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
  } catch (err) {
    data = { users: {} };
  }
}

function scheduleSave() {
  if (remote) {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushRemote();
    }, PUSH_DEBOUNCE_MS);
    pushTimer.unref();
  } else {
    saveLocal();
  }
}

function mutate(fn) {
  fn(data);
  scheduleSave();
}

function get() {
  return data;
}

function start() {
  if (remote) {
    pullRemote();
    pullTimer = setInterval(() => {
      if (Date.now() - lastPullAt >= PULL_EVERY_MS) pullRemote();
    }, PULL_EVERY_MS);
    pullTimer.unref();
  } else {
    loadLocal();
    if (Object.keys(data.users).length === 0) saveLocal();
    console.log('[vault] env incomplete, using local file ' + LOCAL_FILE);
  }
}

module.exports = { start, mutate, get, remote };
