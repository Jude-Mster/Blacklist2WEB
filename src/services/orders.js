'use strict';
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const coins = require('./coins');

const REF_RE = /^\d{13}$/; // GCash reference numbers are 13 digits

async function expireOld() {
  await db.run("UPDATE orders SET status = 'expired' WHERE status = 'awaiting_payment' AND expires_at < NOW()");
}

/**
 * Creates a GCash order. The amount gets unique centavos (.01–.99) among open orders, so each
 * payment in the GCash history matches exactly one order.
 */
async function create(user, packId) {
  await expireOld();
  const pack = await db.one('SELECT * FROM packs WHERE id = ? AND active = 1', [packId]);
  if (!pack) return { error: 'That pack is not available.' };
  const open = await db.one("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'awaiting_payment'", [user.id]);
  if (open.n >= 3) return { error: 'You already have 3 unpaid orders. Pay or wait for them to expire first.' };

  const taken = new Set((await db.all(
    "SELECT ROUND((amount_php - FLOOR(amount_php)) * 100) AS c FROM orders WHERE status IN ('awaiting_payment','submitted') AND FLOOR(amount_php) = FLOOR(?)",
    [pack.price_php])).map((r) => Number(r.c)));
  const free = [];
  for (let c = 1; c <= 99; c++) if (!taken.has(c)) free.push(c);
  if (!free.length) return { error: 'Too many open orders right now. Try again in a few minutes.' };
  const cents = free[crypto.randomInt(free.length)];
  const amount = (Math.floor(Number(pack.price_php)) + cents / 100).toFixed(2);

  const orderNo = 'B2' + crypto.randomBytes(5).toString('hex').toUpperCase();
  await db.run(
    `INSERT INTO orders (order_no, user_id, pack_id, coins, amount_php, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [orderNo, user.id, pack.id, pack.coins + pack.bonus, amount, config.gcash.orderTtlMinutes],
  );
  return { orderNo };
}

async function submitReference(user, orderNo, ref) {
  const clean = String(ref || '').replace(/\D/g, '');
  if (!REF_RE.test(clean)) return { error: 'Enter the 13-digit GCash reference number from your receipt.' };
  await expireOld();
  const o = await db.one('SELECT * FROM orders WHERE order_no = ? AND user_id = ?', [orderNo, user.id]);
  if (!o) return { error: 'Order not found.' };
  if (o.status !== 'awaiting_payment') return { error: 'This order can no longer be changed.' };
  try {
    await db.run("UPDATE orders SET reference_no = ?, status = 'submitted', submitted_at = NOW() WHERE id = ?", [clean, o.id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return { error: 'That reference number was already used for another order.' };
    throw e;
  }
  return { ok: true };
}

/** Admin approves: marks approved and grants the coins once. */
async function approve(orderId, adminId) {
  const o = await db.one('SELECT o.*, u.account_id FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?', [orderId]);
  if (!o || o.status !== 'submitted') return { error: 'Only submitted orders can be approved.' };
  await db.run("UPDATE orders SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'submitted'", [adminId, o.id]);
  const credit = await coins.grant({ id: o.user_id, account_id: o.account_id }, 'order', o.id, o.coins);
  return { delivered: credit.status === 'done', error: credit.status === 'done' ? null : credit.last_error };
}

async function reject(orderId, adminId, note) {
  const r = await db.run(
    "UPDATE orders SET status = 'rejected', note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status IN ('submitted','awaiting_payment')",
    [String(note || '').slice(0, 250), adminId, orderId]);
  return r.affectedRows ? { ok: true } : { error: 'Order not found or already reviewed.' };
}

module.exports = { create, submitReference, approve, reject, expireOld };
