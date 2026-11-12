'use strict';
// A fake game server kept in memory. Used when GAME_API_MODE=mock so the website can be
// built, previewed and tested without the real game server. Data resets on restart.
const accounts = new Map(); // accountId(lowercase) -> { accountId, password, coins, applied:Set }
const FACTIONS = ['Guanyin', 'Fujin', 'Jinong', 'Nangin'];

function err(code, message) { const e = new Error(message); e.code = code; throw e; }

async function handle(method, pathAndQuery, body) {
  const [p, q] = pathAndQuery.split('?');
  const payload = body || {};
  const params = new URLSearchParams(q || '');
  const key = (s) => String(s || '').toLowerCase();

  if (method === 'GET' && p === '/v1/status') {
    return { ok: true, online: true, players: 0, serverTime: new Date().toISOString(), mock: true };
  }
  let m;
  if (method === 'GET' && (m = p.match(/^\/v1\/accounts\/([^/]+)$/))) {
    return { ok: true, exists: accounts.has(key(decodeURIComponent(m[1]))) };
  }
  if (method === 'POST' && p === '/v1/accounts') {
    if (accounts.has(key(payload.accountId))) err('account_exists', 'That account ID is taken.');
    accounts.set(key(payload.accountId), { accountId: payload.accountId, password: payload.password, coins: 0, applied: new Set() });
    return { ok: true };
  }
  if (method === 'POST' && p === '/v1/accounts/verify') {
    const a = accounts.get(key(payload.accountId));
    return { ok: true, valid: !!a && a.password === payload.password };
  }
  if (method === 'POST' && p === '/v1/accounts/password') {
    const a = accounts.get(key(payload.accountId));
    if (!a) err('no_account', 'Account not found.');
    a.password = payload.password;
    return { ok: true };
  }
  if (method === 'GET' && (m = p.match(/^\/v1\/accounts\/([^/]+)\/characters$/))) {
    const a = accounts.get(key(decodeURIComponent(m[1])));
    if (!a) return { ok: true, characters: [] };
    return { ok: true, characters: [{ name: `Mock_${a.accountId}`.slice(0, 12), faction: 'Jinong', level: 1, pk: 0, zone: 1 }] };
  }
  if (method === 'GET' && (m = p.match(/^\/v1\/accounts\/([^/]+)\/coins$/))) {
    const a = accounts.get(key(decodeURIComponent(m[1])));
    return { ok: true, balance: a ? a.coins : 0 };
  }
  if (method === 'POST' && p === '/v1/coins/add') {
    const a = accounts.get(key(payload.accountId));
    if (!a) err('no_account', 'Account not found.');
    if (!a.applied.has(payload.creditId)) { a.applied.add(payload.creditId); a.coins += Number(payload.coins); }
    return { ok: true, balance: a.coins };
  }
  if (method === 'POST' && p === '/v1/characters/unstuck') return { ok: true };
  if (method === 'GET' && p === '/v1/rankings') {
    const type = params.get('type');
    const rows = Array.from({ length: 8 }, (_, i) => ({
      rank: i + 1, name: `MockHero${i + 1}`, faction: FACTIONS[i % 4], guild: i % 3 ? 'MockGuild' : '',
      value: type === 'pk' ? 80 - i * 9 : type === 'duel' ? 40 - i * 4 : type === 'guild' ? 30 - i * 3 : 120 - i * 7,
    }));
    return { ok: true, rows };
  }
  if (method === 'GET' && p === '/v1/factions') {
    return { ok: true, factions: FACTIONS.map((name) => ({ name, players: 0, pkKillsWeek: 0 })) };
  }
  err('not_found', `Mock has no ${method} ${p}`);
}

module.exports = { handle };
