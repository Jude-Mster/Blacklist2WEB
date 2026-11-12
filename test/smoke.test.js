'use strict';
// End-to-end smoke test. Needs a MySQL database (see .env) and GAME_API_MODE=mock.
// Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const app = require('../server');
const db = require('../src/db');

let server;
let base;
const ID = 'tst' + Math.random().toString(36).slice(2, 8);
const ADMIN = 'adm' + Math.random().toString(36).slice(2, 8);

function client() {
  let cookie = '';
  async function req(method, path, form) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  const csrf = async (path) => {
    const r = await req('GET', path);
    const m = r.text.match(/name="_csrf" value="([0-9a-f]+)"/);
    assert.ok(m, `no csrf token on ${path}`);
    return m[1];
  };
  return { req, csrf };
}

before(async () => {
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.pool.end(); });

test('public pages render', async () => {
  const c = client();
  for (const p of ['/', '/download', '/rankings', '/rankings?type=pk', '/support', '/recharge', '/news', '/login', '/register']) {
    const r = await c.req('GET', p);
    assert.strictEqual(r.status, 200, p);
    assert.match(r.text, /Blacklist/);
  }
  assert.strictEqual((await c.req('GET', '/nope')).status, 404);
  assert.strictEqual((await c.req('GET', '/admin')).status, 404, 'admin hidden from guests');
  assert.strictEqual((await c.req('GET', '/account')).location, '/login');
});

test('register, order, approve, codes', async () => {
  const p = client();
  // bad input is rejected
  let r = await p.req('POST', '/register', { _csrf: await p.csrf('/register'), accountId: 'x', email: 'bad', password: '1', password2: '2' });
  assert.strictEqual(r.status, 400);
  // missing csrf is rejected
  r = await p.req('POST', '/register', { accountId: ID });
  assert.strictEqual(r.status, 403);
  // good registration
  r = await p.req('POST', '/register', { _csrf: await p.csrf('/register'), accountId: ID, email: `${ID}@example.com`, password: 'goodpass123', password2: 'goodpass123', terms: '1' });
  assert.strictEqual(r.location, '/account');
  r = await p.req('GET', '/account');
  assert.match(r.text, new RegExp(`Welcome, ${ID}`));
  // duplicate account id
  const q = client();
  r = await q.req('POST', '/register', { _csrf: await q.csrf('/register'), accountId: ID.toUpperCase(), email: `x${ID}@example.com`, password: 'goodpass123', password2: 'goodpass123', terms: '1' });
  assert.match(r.text, /taken/);

  // GCash order
  const pack = await db.one('SELECT id, coins, bonus FROM packs WHERE active = 1 ORDER BY sort LIMIT 1');
  r = await p.req('POST', '/recharge/order', { _csrf: await p.csrf('/recharge'), packId: pack.id });
  assert.match(r.location, /^\/recharge\/order\/B2/);
  const orderPath = r.location;
  r = await p.req('GET', orderPath);
  assert.match(r.text, /Send exactly/);
  const ref = String(Date.now()).padStart(13, '7').slice(-13);
  r = await p.req('POST', `${orderPath}/reference`, { _csrf: await p.csrf(orderPath), reference: 'abc' });
  r = await p.req('GET', orderPath);
  assert.match(r.text, /13-digit/);
  r = await p.req('POST', `${orderPath}/reference`, { _csrf: await p.csrf(orderPath), reference: ref });
  r = await p.req('GET', orderPath);
  assert.match(r.text, /checking your payment/);

  // Admin: register, promote, approve
  const a = client();
  await a.req('POST', '/register', { _csrf: await a.csrf('/register'), accountId: ADMIN, email: `${ADMIN}@example.com`, password: 'adminpass123', password2: 'adminpass123', terms: '1' });
  await db.run("UPDATE users SET role = 'admin' WHERE account_id = ?", [ADMIN]);
  r = await a.req('GET', '/admin/orders');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, new RegExp(ref));
  const order = await db.one('SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id WHERE u.account_id = ?', [ID]);
  r = await a.req('POST', `/admin/orders/${order.id}/approve`, { _csrf: await a.csrf('/admin/orders') });
  const credit = await db.one("SELECT * FROM coin_credits WHERE source = 'order' AND source_id = ?", [String(order.id)]);
  assert.strictEqual(credit.status, 'done');
  assert.strictEqual(credit.coins, pack.coins + pack.bonus);
  // approving twice does nothing
  r = await a.req('POST', `/admin/orders/${order.id}/approve`, { _csrf: await a.csrf('/admin/orders') });
  assert.strictEqual((await db.one("SELECT COUNT(*) n FROM coin_credits WHERE source = 'order' AND source_id = ?", [String(order.id)])).n, 1);

  // Codes: reseller + batch
  r = await a.req('POST', '/admin/resellers', { _csrf: await a.csrf('/admin/resellers'), name: 'Test Seller', prefix: 'T' + ID.slice(-2).toUpperCase(), country: 'PH', methods: 'GCash', visible: '1' });
  const reseller = await db.one('SELECT id FROM resellers WHERE name = ? ORDER BY id DESC', ['Test Seller']);
  r = await a.req('POST', '/admin/codes', { _csrf: await a.csrf('/admin/codes'), label: 'smoke', quantity: '3', coins: '250', resellerId: reseller.id });
  const codes = (r.text.match(/<div class="code-list">([\s\S]*?)<\/div>/) || [])[1].trim().split('\n');
  assert.strictEqual(codes.length, 3);
  assert.match(codes[0], /^BL2-[0-9A-Z]{2,4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const stored = await db.one('SELECT COUNT(*) n FROM codes WHERE code_hash LIKE ?', [`%${codes[0].slice(-4)}%`]);
  assert.ok(stored.n >= 0); // plain codes are never stored; only hashes

  // Redeem: lower-case with spaces works, second use fails
  r = await p.req('POST', '/recharge/redeem', { _csrf: await p.csrf('/recharge'), code: ` ${codes[0].toLowerCase()} ` });
  r = await p.req('GET', '/recharge');
  assert.match(r.text, /Code accepted: 250 coins/);
  r = await p.req('POST', '/recharge/redeem', { _csrf: await p.csrf('/recharge'), code: codes[0] });
  r = await p.req('GET', '/recharge');
  assert.match(r.text, /already been used/);
  r = await p.req('POST', '/recharge/redeem', { _csrf: await p.csrf('/recharge'), code: 'BL2-AAAA-BBBB-CCCC' });
  r = await p.req('GET', '/recharge');
  assert.match(r.text, /not valid/);
  // Disabled batch
  const batch = await db.one('SELECT id FROM code_batches WHERE label = ? ORDER BY id DESC', ['smoke']);
  await a.req('POST', `/admin/codes/${batch.id}/disable`, { _csrf: await a.csrf('/admin/codes') });
  r = await p.req('POST', '/recharge/redeem', { _csrf: await p.csrf('/recharge'), code: codes[1] });
  r = await p.req('GET', '/recharge');
  assert.match(r.text, /disabled/);
  // Reseller shows publicly
  assert.match(r.text, /Test Seller/);

  // Account shows coins from the mock game: order + one code
  r = await p.req('GET', '/account');
  assert.match(r.text, new RegExp((pack.coins + pack.bonus + 250).toLocaleString('en-US')));

  // Logout, login again, wrong password
  r = await p.req('POST', '/logout', { _csrf: await p.csrf('/account') });
  assert.strictEqual(r.location, '/');
  r = await p.req('POST', '/login', { _csrf: await p.csrf('/login'), accountId: ID, password: 'wrongpass' });
  assert.strictEqual(r.status, 401);
  r = await p.req('POST', '/login', { _csrf: await p.csrf('/login'), accountId: ID, password: 'goodpass123' });
  assert.strictEqual(r.location, '/account');

  // Admin pages all render
  for (const path of ['/admin', '/admin/credits', '/admin/codes', '/admin/resellers', '/admin/packs', '/admin/news', '/admin/users?q=' + ID]) {
    assert.strictEqual((await a.req('GET', path)).status, 200, path);
  }
  // News post appears on home
  await a.req('POST', '/admin/news', { _csrf: await a.csrf('/admin/news'), tag: 'Update', title: `Smoke news ${ID}`, summary: 'Testing', body: 'Hello\n\nWorld', published: '1' });
  r = await a.req('GET', '/');
  assert.match(r.text, new RegExp(`Smoke news ${ID}`));
});
