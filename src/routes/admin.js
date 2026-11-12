'use strict';
const express = require('express');
const db = require('../db');
const orders = require('../services/orders');
const codes = require('../services/codes');
const coins = require('../services/coins');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAdmin);
router.use((req, res, next) => { res.locals.admin = true; next(); });

const log = (req, action, detail = '') => db.run('INSERT INTO admin_log (admin_id, action, detail) VALUES (?, ?, ?)', [req.user.id, action, String(detail).slice(0, 500)]);
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);

router.get('/', wrap(async (req, res) => {
  await orders.expireOld();
  const [stats] = await Promise.all([db.one(`SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM orders WHERE status = 'submitted') AS pending,
    (SELECT COUNT(*) FROM coin_credits WHERE status = 'failed') AS failed,
    (SELECT COALESCE(SUM(amount_php),0) FROM orders WHERE status = 'approved' AND reviewed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS php30,
    (SELECT COUNT(*) FROM codes WHERE redeemed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS codes30`)]);
  const recent = await db.all('SELECT l.*, u.account_id FROM admin_log l JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 15');
  res.render('admin/dashboard', { title: 'Admin', stats, recent });
}));

// ---------- GCash orders
router.get('/orders', wrap(async (req, res) => {
  await orders.expireOld();
  const status = ['submitted', 'awaiting_payment', 'approved', 'rejected', 'expired'].includes(req.query.status) ? req.query.status : 'submitted';
  const rows = await db.all(
    `SELECT o.*, u.account_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = ?
     ORDER BY o.created_at ${status === 'submitted' ? 'ASC' : 'DESC'} LIMIT 200`, [status]);
  res.render('admin/orders', { title: 'Orders', rows, status });
}));

router.post('/orders/:id/approve', wrap(async (req, res) => {
  const r = await orders.approve(int(req.params.id), req.user.id);
  if (r.error && !('delivered' in r)) req.flash('error', r.error);
  else {
    await log(req, 'order.approve', `order ${req.params.id}`);
    req.flash(r.delivered ? 'ok' : 'error', r.delivered ? 'Approved and coins delivered.' : `Approved, but the coins could not be delivered yet (${r.error}). Retry from Credits.`);
  }
  res.redirect('/admin/orders');
}));

router.post('/orders/:id/reject', wrap(async (req, res) => {
  const r = await orders.reject(int(req.params.id), req.user.id, req.body.note);
  if (r.error) req.flash('error', r.error); else { await log(req, 'order.reject', `order ${req.params.id}: ${req.body.note || ''}`); req.flash('ok', 'Order rejected.'); }
  res.redirect('/admin/orders');
}));

// ---------- Coin credits (failed deliveries)
router.get('/credits', wrap(async (req, res) => {
  const rows = await db.all(`SELECT c.*, u.account_id FROM coin_credits c JOIN users u ON u.id = c.user_id
    ORDER BY (c.status = 'failed') DESC, c.id DESC LIMIT 200`);
  res.render('admin/credits', { title: 'Coin deliveries', rows });
}));

router.post('/credits/:id/retry', wrap(async (req, res) => {
  const r = await coins.retry(int(req.params.id));
  req.flash(r && r.status === 'done' ? 'ok' : 'error', r && r.status === 'done' ? 'Delivered.' : `Still failing: ${r ? r.last_error : 'not found'}`);
  res.redirect('/admin/credits');
}));

router.post('/credits/grant', wrap(async (req, res) => {
  const u = await db.one('SELECT id, account_id FROM users WHERE account_id = ?', [String(req.body.accountId || '').trim()]);
  const amount = int(req.body.coins);
  if (!u || amount <= 0 || amount > 1_000_000) { req.flash('error', 'Unknown account or bad amount.'); return res.redirect('/admin/credits'); }
  const r = await coins.grant(u, 'admin', `${Date.now()}-${req.user.id}`, amount);
  await log(req, 'coins.grant', `${amount} to ${u.account_id}: ${req.body.reason || ''}`);
  req.flash(r.status === 'done' ? 'ok' : 'error', r.status === 'done' ? `Gave ${amount} coins to ${u.account_id}.` : `Recorded, delivery failed: ${r.last_error}`);
  res.redirect('/admin/credits');
}));

// ---------- Codes
router.get('/codes', wrap(async (req, res) => {
  const batches = await db.all(`SELECT b.*, r.name AS reseller, r.prefix,
      (SELECT COUNT(*) FROM codes c WHERE c.batch_id = b.id AND c.redeemed_by IS NOT NULL) AS used
    FROM code_batches b LEFT JOIN resellers r ON r.id = b.reseller_id ORDER BY b.id DESC LIMIT 200`);
  const resellers = await db.all('SELECT id, name, prefix FROM resellers ORDER BY name');
  res.render('admin/codes', { title: 'Codes', batches, resellers, created: null });
}));

router.post('/codes', wrap(async (req, res) => {
  const quantity = int(req.body.quantity);
  const coinsEach = int(req.body.coins);
  const label = String(req.body.label || '').trim().slice(0, 120) || 'Batch';
  if (quantity < 1 || quantity > 2000 || coinsEach < 1 || coinsEach > 1_000_000) {
    req.flash('error', 'Quantity must be 1–2000 and coins 1–1,000,000.');
    return res.redirect('/admin/codes');
  }
  const expiresAt = req.body.expires ? new Date(`${req.body.expires}T23:59:59Z`) : null;
  const out = await codes.createBatch({ label, coinsEach, quantity, resellerId: int(req.body.resellerId) || null, expiresAt, adminId: req.user.id });
  await log(req, 'codes.create', `batch ${out.batchId}: ${quantity} × ${coinsEach}`);
  const batches = await db.all(`SELECT b.*, r.name AS reseller, r.prefix,
      (SELECT COUNT(*) FROM codes c WHERE c.batch_id = b.id AND c.redeemed_by IS NOT NULL) AS used
    FROM code_batches b LEFT JOIN resellers r ON r.id = b.reseller_id ORDER BY b.id DESC LIMIT 200`);
  const resellers = await db.all('SELECT id, name, prefix FROM resellers ORDER BY name');
  // Shown once. The codes are not stored, so they cannot be shown again.
  res.set('Cache-Control', 'no-store');
  res.render('admin/codes', { title: 'Codes', batches, resellers, created: { ...out, label, coinsEach } });
}));

router.post('/codes/:id/disable', wrap(async (req, res) => {
  await db.run('UPDATE code_batches SET disabled = 1 WHERE id = ?', [int(req.params.id)]);
  await log(req, 'codes.disable', `batch ${req.params.id}`);
  req.flash('ok', 'Batch disabled. Unused codes in it no longer work.');
  res.redirect('/admin/codes');
}));

router.post('/codes/lookup', wrap(async (req, res) => {
  const row = await db.one(`SELECT c.*, b.label, b.coins, u.account_id FROM codes c JOIN code_batches b ON b.id = c.batch_id
    LEFT JOIN users u ON u.id = c.redeemed_by WHERE c.code_hash = ?`, [codes.hash(req.body.code)]);
  if (!row) req.flash('error', 'No such code.');
  else req.flash('ok', `Batch "${row.label}", ${row.coins} coins — ${row.redeemed_by ? `used by ${row.account_id} on ${row.redeemed_at.toISOString().slice(0, 16)}` : row.disabled ? 'disabled' : 'unused'}.`);
  res.redirect('/admin/codes');
}));

// ---------- Resellers
router.get('/resellers', wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM resellers ORDER BY name');
  res.render('admin/resellers', { title: 'Resellers', rows });
}));

router.post('/resellers', wrap(async (req, res) => {
  const prefix = String(req.body.prefix || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 4);
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name || prefix.length < 2) { req.flash('error', 'Name and a 2–4 character prefix are required.'); return res.redirect('/admin/resellers'); }
  try {
    await db.run('INSERT INTO resellers (name, prefix, country, contact, methods, visible) VALUES (?, ?, ?, ?, ?, ?)',
      [name, prefix, String(req.body.country || '').slice(0, 60), String(req.body.contact || '').slice(0, 200), String(req.body.methods || '').slice(0, 200), req.body.visible ? 1 : 0]);
    await log(req, 'reseller.add', `${name} (${prefix})`);
    req.flash('ok', 'Reseller added.');
  } catch (e) {
    req.flash('error', e.code === 'ER_DUP_ENTRY' ? 'That prefix is already used.' : e.message);
  }
  res.redirect('/admin/resellers');
}));

router.post('/resellers/:id/toggle', wrap(async (req, res) => {
  await db.run('UPDATE resellers SET visible = 1 - visible WHERE id = ?', [int(req.params.id)]);
  res.redirect('/admin/resellers');
}));

// ---------- News
router.get('/news', wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM news ORDER BY created_at DESC LIMIT 100');
  const edit = req.query.edit ? await db.one('SELECT * FROM news WHERE id = ?', [int(req.query.edit)]) : null;
  res.render('admin/news', { title: 'News', rows, edit });
}));

router.post('/news', wrap(async (req, res) => {
  const tag = ['Update', 'Event', 'Notice', 'Maintenance'].includes(req.body.tag) ? req.body.tag : 'Update';
  const f = [tag, String(req.body.title || '').trim().slice(0, 160), String(req.body.summary || '').trim().slice(0, 400), String(req.body.body || '').trim(), req.body.published ? 1 : 0];
  if (!f[1] || !f[2]) { req.flash('error', 'Title and summary are required.'); return res.redirect('/admin/news'); }
  if (req.body.id) await db.run('UPDATE news SET tag = ?, title = ?, summary = ?, body = ?, published = ? WHERE id = ?', [...f, int(req.body.id)]);
  else await db.run('INSERT INTO news (tag, title, summary, body, published) VALUES (?, ?, ?, ?, ?)', f);
  await log(req, req.body.id ? 'news.edit' : 'news.add', f[1]);
  req.flash('ok', 'News saved.');
  res.redirect('/admin/news');
}));

// ---------- Packs
router.get('/packs', wrap(async (req, res) => {
  res.render('admin/packs', { title: 'Coin packs', rows: await db.all('SELECT * FROM packs ORDER BY sort, price_php') });
}));

router.post('/packs', wrap(async (req, res) => {
  const v = [int(req.body.coins), int(req.body.bonus), Number(req.body.price_php), req.body.price_usd ? Number(req.body.price_usd) : null, req.body.active ? 1 : 0, int(req.body.sort)];
  if (v[0] <= 0 || !(v[2] > 0)) { req.flash('error', 'Coins and PHP price are required.'); return res.redirect('/admin/packs'); }
  if (req.body.id) await db.run('UPDATE packs SET coins = ?, bonus = ?, price_php = ?, price_usd = ?, active = ?, sort = ? WHERE id = ?', [...v, int(req.body.id)]);
  else await db.run('INSERT INTO packs (coins, bonus, price_php, price_usd, active, sort) VALUES (?, ?, ?, ?, ?, ?)', v);
  await log(req, 'packs.save', JSON.stringify(v));
  req.flash('ok', 'Pack saved.');
  res.redirect('/admin/packs');
}));

// ---------- Users
router.get('/users', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? await db.all('SELECT * FROM users WHERE account_id LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 50', [`%${q}%`, `%${q}%`])
    : await db.all('SELECT * FROM users ORDER BY id DESC LIMIT 50');
  res.render('admin/users', { title: 'Users', rows, q });
}));

router.post('/users/:id/ban', wrap(async (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) { req.flash('error', 'You cannot ban yourself.'); return res.redirect('/admin/users'); }
  await db.run('UPDATE users SET banned = 1 - banned WHERE id = ?', [id]);
  await log(req, 'user.ban.toggle', `user ${id}`);
  res.redirect('/admin/users');
}));

module.exports = router;
