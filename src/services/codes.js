'use strict';
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const coins = require('./coins');

// Crockford-style alphabet: no 0/O, 1/I/L, U, so codes are easy to read and type.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomGroup(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

/** BL2-<PREFIX>-XXXX-XXXX-XXXX (prefix optional). 12 random chars ≈ 59 bits. */
function makeCode(prefix) {
  const parts = ['BL2'];
  if (prefix) parts.push(prefix);
  parts.push(randomGroup(4), randomGroup(4), randomGroup(4));
  return parts.join('-');
}

function normalize(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function hash(code) {
  return crypto.createHash('sha256').update(config.codePepper + normalize(code)).digest('hex');
}

/** Creates a batch and returns the plain codes. They are shown once and never stored. */
async function createBatch({ label, coinsEach, quantity, resellerId, expiresAt, adminId }) {
  const reseller = resellerId ? await db.one('SELECT * FROM resellers WHERE id = ?', [resellerId]) : null;
  const prefix = reseller ? reseller.prefix : '';
  return db.tx(async (conn) => {
    const [res] = await conn.query(
      'INSERT INTO code_batches (reseller_id, label, coins, quantity, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [reseller ? reseller.id : null, label, coinsEach, quantity, expiresAt || null, adminId],
    );
    const batchId = res.insertId;
    const plain = [];
    while (plain.length < quantity) {
      const code = makeCode(prefix);
      const h = hash(code);
      const hint = `${prefix ? prefix + '…' : '…'}${code.slice(-4)}`;
      const [r] = await conn.query('INSERT IGNORE INTO codes (batch_id, code_hash, hint) VALUES (?, ?, ?)', [batchId, h, hint]);
      if (r.affectedRows) plain.push(code);
    }
    return { batchId, codes: plain };
  });
}

/**
 * Redeems a code for a user. Marks it used inside a locked transaction, then grants the coins
 * (the grant is recorded even if the game is offline, and can be retried).
 */
async function redeem(user, input) {
  const h = hash(input);
  const result = await db.tx(async (conn) => {
    const [rows] = await conn.query(
      `SELECT c.id, c.disabled, c.redeemed_by, b.coins, b.disabled AS batch_disabled, b.expires_at
         FROM codes c JOIN code_batches b ON b.id = c.batch_id WHERE c.code_hash = ? FOR UPDATE`, [h]);
    const c = rows[0];
    if (!c) return { error: 'That code is not valid. Check it and try again.' };
    if (c.redeemed_by) return { error: 'That code has already been used.' };
    if (c.disabled || c.batch_disabled) return { error: 'That code has been disabled. Contact the seller.' };
    if (c.expires_at && new Date(c.expires_at) < new Date()) return { error: 'That code has expired.' };
    await conn.query('UPDATE codes SET redeemed_by = ?, redeemed_at = NOW() WHERE id = ?', [user.id, c.id]);
    return { codeId: c.id, coins: c.coins };
  });
  if (result.error) return result;
  const credit = await coins.grant(user, 'code', result.codeId, result.coins);
  return { coins: result.coins, delivered: credit.status === 'done' };
}

module.exports = { createBatch, redeem, makeCode, normalize, hash };
