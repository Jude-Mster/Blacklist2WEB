'use strict';
// The signed bot API: signatures, freshness, input checks, one code per order. Needs MySQL.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

process.env.COMING_SOON = 'true'; // the bot API must work even in Coming Soon mode
process.env.BOT_API_SECRET = 'test-bot-secret-0123456789abcdefghijklmnop';
const app = require('../server');
const db = require('../src/db');
const codes = require('../src/services/codes');
const { sign } = require('../src/routes/internal');

const SECRET = process.env.BOT_API_SECRET;
const TAG = Math.random().toString(36).slice(2, 8).toUpperCase();
let server;
let base;
let userId;

function call(method, path, bodyObj, { secret = SECRET, ts = Math.floor(Date.now() / 1000), tamper = false } = {}) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const sig = sign(secret, String(ts), method, path, body);
  return fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-b2-timestamp': String(ts), 'x-b2-signature': sig },
    body: method === 'GET' ? undefined : (tamper ? body.replace('1', '2') : body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), cache: r.headers.get('cache-control') }));
}

before(async () => {
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await db.run("INSERT IGNORE INTO users (account_id, pass_hash, role) VALUES (?, 'x', 'admin')", [`botadm${TAG}`.slice(0, 16)]);
  const r = await db.run("INSERT INTO users (account_id, pass_hash) VALUES (?, 'x')", [`botusr${TAG}`.slice(0, 16)]);
  userId = r.insertId;
});
after(async () => { server.close(); await db.pool.end(); });

test('unsigned, wrongly signed, stale or tampered requests are refused', async () => {
  const plain = await fetch(`${base}/internal/bot/packs`);
  assert.strictEqual(plain.status, 401);
  assert.strictEqual((await call('GET', '/internal/bot/packs', null, { secret: 'x'.repeat(40) })).status, 401);
  assert.strictEqual((await call('GET', '/internal/bot/packs', null, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
  const r = await call('POST', '/internal/bot/mint', { orderRef: `DC-${TAG}-T`, packId: 1, discordUser: '123456789' }, { tamper: true });
  assert.strictEqual(r.status, 401);
});

test('packs are listed, never cached', async () => {
  const r = await call('GET', '/internal/bot/packs');
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json.packs) && r.json.packs.length > 0);
  assert.match(r.cache || '', /no-store/);
});

test('mint gives one working code per order, never two', async () => {
  const { packs } = (await call('GET', '/internal/bot/packs')).json;
  const pack = packs[0];
  const ref = `DC-${TAG}-1`;

  assert.strictEqual((await call('POST', '/internal/bot/mint', { orderRef: 'bad ref', packId: pack.id, discordUser: '123456789' })).status, 400);
  assert.strictEqual((await call('POST', '/internal/bot/mint', { orderRef: ref, packId: 999999, discordUser: '123456789' })).status, 400);
  assert.strictEqual((await call('POST', '/internal/bot/mint', { orderRef: ref, packId: '1', discordUser: '123456789' })).status, 400);

  const first = await call('POST', '/internal/bot/mint', { orderRef: ref, packId: pack.id, discordUser: '123456789' });
  assert.strictEqual(first.status, 200);
  assert.match(first.json.code, /^BL2-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.strictEqual(first.json.coins, pack.coins + pack.bonus);

  const again = await call('POST', '/internal/bot/mint', { orderRef: ref, packId: pack.id, discordUser: '123456789' });
  assert.strictEqual(again.status, 409, 'same order cannot mint twice');

  const used = await codes.redeem({ id: userId }, first.json.code);
  assert.strictEqual(used.coins, pack.coins + pack.bonus);
  const twice = await codes.redeem({ id: userId }, first.json.code);
  assert.ok(twice.error, 'code works once');

  const logRow = await db.one("SELECT detail FROM admin_log WHERE action = 'bot.mint' AND detail LIKE ?", [`%${ref}%`]);
  assert.ok(logRow && !logRow.detail.includes(first.json.code), 'logged without the full code');
});
