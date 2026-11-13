'use strict';
// Coming Soon mode: visitors only see the landing page; login, admin and assets keep working.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

process.env.COMING_SOON = 'true';
process.env.LAUNCH_DATE = '2030-01-01T00:00:00Z';
const app = require('../server');
const db = require('../src/db');

let server;
let base;
before(() => { server = http.createServer(app).listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.close(); await db.pool.end(); });

const get = (p) => fetch(base + p, { redirect: 'manual' });

test('home shows the coming soon page with countdown', async () => {
  const r = await get('/');
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.match(html, /Coming soon/);
  assert.match(html, /\/img\/logo\.png/);
  assert.match(html, /data-launch="2030-01-01T00:00:00.000Z"/);
});

test('other pages redirect home; login, admin gate and assets stay open', async () => {
  for (const p of ['/register', '/rankings', '/recharge', '/download', '/account']) {
    const r = await get(p);
    assert.strictEqual(r.status, 302, p);
    assert.strictEqual(r.headers.get('location'), '/', p);
  }
  assert.strictEqual((await get('/login')).status, 200);
  assert.strictEqual((await get('/admin')).status, 404); // hidden from non-admins
  for (const p of ['/img/hero-bg.jpg', '/img/logo.png', '/css/coming-soon.css', '/js/countdown.js']) {
    assert.strictEqual((await get(p)).status, 200, p);
  }
});
