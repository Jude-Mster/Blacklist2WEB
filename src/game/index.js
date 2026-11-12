'use strict';
// The website's only door into the game. Real mode talks to the private Game API on the
// game server (docs/GAME_API.md); mock mode keeps a fake game in memory for development.
const crypto = require('crypto');
const config = require('../config');
const mock = require('./mock');

class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function sign(ts, method, pathAndQuery, body) {
  return crypto.createHmac('sha256', config.game.secret).update(`${ts}.${method}.${pathAndQuery}.${body}`).digest('hex');
}

async function call(method, pathAndQuery, payload) {
  if (config.game.mode === 'mock') return mock.handle(method, pathAndQuery, payload);
  const body = payload ? JSON.stringify(payload) : '';
  const ts = Math.floor(Date.now() / 1000).toString();
  let res;
  try {
    res = await fetch(config.game.url + pathAndQuery, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-b2-timestamp': ts,
        'x-b2-signature': sign(ts, method, pathAndQuery, body),
      },
      body: body || undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    throw new GameError('unreachable', 'The game server is not reachable right now.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok || data.ok === false) throw new GameError(data.error || `http_${res.status}`, data.message || 'The game server refused the request.');
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
