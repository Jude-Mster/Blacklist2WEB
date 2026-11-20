'use strict';
// The website's only door into the game. Real mode talks to the private Game API on the
// game server (docs/GAME_API.md); mock mode keeps a fake game in memory for development.
const crypto = require('crypto');
const https = require('https');
const config = require('../config');
const mock = require('./mock');

class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function sign(ts, nonce, method, pathAndQuery, body) {
  return crypto.createHmac('sha256', config.game.secret).update(`${ts}.${nonce}.${method}.${pathAndQuery}.${body}`).digest('hex');
}

// The game server's certificate is its own (made by the game server, see docs/GAME_API.md), so the site trusts
// exactly that one certificate (GAME_API_CA) instead of the public CAs. Without GAME_API_CA the normal public CAs
// apply (a tunnel with a public certificate). Plain http:// is refused: the password travels in the body.
const agent = config.game.ca ? new https.Agent({ ca: config.game.ca, keepAlive: false, minVersion: 'TLSv1.2' }) : undefined;

function send(method, pathAndQuery, body, headers) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(config.game.url + pathAndQuery); } catch { return reject(new Error('bad GAME_API_URL')); }
    if (url.protocol !== 'https:') return reject(new Error('GAME_API_URL must be https'));
    const req = https.request(url, {
      method,
      agent,
      headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 1_000_000) req.destroy(new Error('answer too large')); else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function call(method, pathAndQuery, payload) {
  if (config.game.mode === 'mock') return mock.handle(method, pathAndQuery, payload);
  if (!config.game.url || !config.game.secret) throw new GameError('unreachable', 'The game server is not reachable right now.');
  const body = payload ? JSON.stringify(payload) : '';
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex'); // new for every request: the game server accepts a nonce once
  let res;
  try {
    res = await send(method, pathAndQuery, body, {
      'content-type': 'application/json',
      'x-b2-timestamp': ts,
      'x-b2-nonce': nonce,
      'x-b2-signature': sign(ts, nonce, method, pathAndQuery, body),
    });
  } catch (e) {
    throw new GameError('unreachable', 'The game server is not reachable right now.');
  }
  let data = {};
  try { data = JSON.parse(res.text); } catch { /* empty */ }
  if (res.status < 200 || res.status >= 300 || data.ok === false) {
    throw new GameError(data.error || `http_${res.status}`, data.message || 'The game server refused the request.');
  }
  return data;
}

// --- small cache for read-only calls
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

module.exports = {
  sign, // exported for the test of the signature format
  GameError,
  /** { online, players, serverTime } */
  statusCached: () => cached('status', 30_000, async () => {
    try { return await call('GET', '/v1/status'); } catch { return { online: false, players: null }; }
  }),
  accountExists: async (accountId) => (await call('GET', `/v1/accounts/${encodeURIComponent(accountId)}`)).exists,
  createAccount: (accountId, password) => call('POST', '/v1/accounts', { accountId, password }),
  verifyLogin: async (accountId, password) => (await call('POST', '/v1/accounts/verify', { accountId, password })).valid === true,
  setPassword: (accountId, password) => call('POST', '/v1/accounts/password', { accountId, password }),
  characters: async (accountId) => (await call('GET', `/v1/accounts/${encodeURIComponent(accountId)}/characters`)).characters || [],
  coinBalance: async (accountId) => (await call('GET', `/v1/accounts/${encodeURIComponent(accountId)}/coins`)).balance,
  /** Idempotent: the game must apply a given creditId only once. */
  addCoins: (accountId, coins, creditId) => call('POST', '/v1/coins/add', { accountId, coins, creditId }),
  unstuck: (accountId, characterName) => call('POST', '/v1/characters/unstuck', { accountId, characterName }),
  rankings: (type) => cached(`rank:${type}`, 120_000, async () => (await call('GET', `/v1/rankings?type=${encodeURIComponent(type)}&limit=50`)).rows || []),
  factions: () => cached('factions', 120_000, async () => (await call('GET', '/v1/factions')).factions || []),
};
