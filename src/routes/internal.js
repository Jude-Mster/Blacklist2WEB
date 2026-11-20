'use strict';
// Machine-to-machine API for the Discord GP bot. No cookies, no sessions, no CSRF: every request
// is signed with BOT_API_SECRET instead (HMAC-SHA256 over "timestamp.METHOD.path.body"), must be
// less than 5 minutes old, and is rate limited. Without BOT_API_SECRET everything here is a 404.
//
//   GET  /internal/bot/packs  -> active packs (what the bot offers)
//   POST /internal/bot/mint   {orderRef, packId, discordUser} -> one single-use code, once per orderRef
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const codes = require('../services/codes');
const log = require('../log');

const router = express.Router();
const MAX_AGE_SEC = 300;
const ORDER_REF_RE = /^[A-Z0-9-]{6,40}$/;
const DISCORD_ID_RE = /^\d{5,25}$/;

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!config.bot.apiSecret || !config.codePepper) return res.status(404).json({ error: 'not_found' });
  next();
});

router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
}));

// Raw body (max 4 kB) so the signature is checked against exactly the bytes that were sent.
router.use(express.raw({ type: '*/*', limit: '4kb' }));

function sign(secret, ts, method, path, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}.${method}.${path}.${body}`).digest('hex');
}

router.use((req, res, next) => {
  const ts = String(req.get('x-b2-timestamp') || '');
  const sig = String(req.get('x-b2-signature') || '').toLowerCase();
  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!/^\d{10}$/.test(ts) || !(age <= MAX_AGE_SEC) || !/^[0-9a-f]{64}$/.test(sig)) {
    return res.status(401).json({ error: 'bad_signature' });
  }
  const expected = sign(config.bot.apiSecret, ts, req.method, req.baseUrl + req.path, body);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).json({ error: 'bad_signature' });
  }
  if (body) {
    try { req.json = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad_json' }); }
  }
  next();
});

router.get('/bot/packs', async (req, res) => {
  try {
    const packs = await db.all('SELECT id, coins, bonus, price_php, price_usd FROM packs WHERE active = 1 ORDER BY sort, id');
    res.json({ packs: packs.map((p) => ({ id: p.id, coins: p.coins, bonus: p.bonus, pricePhp: Number(p.price_php), priceUsd: p.price_usd == null ? null : Number(p.price_usd) })) });
  } catch (err) {
    log.requestError(req, err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/bot/mint', async (req, res) => {
  const b = req.json || {};
  const orderRef = typeof b.orderRef === 'string' ? b.orderRef : '';
  const packId = Number.isInteger(b.packId) ? b.packId : NaN;
  const discordUser = typeof b.discordUser === 'string' ? b.discordUser : '';
  if (!ORDER_REF_RE.test(orderRef) || !(packId > 0) || !DISCORD_ID_RE.test(discordUser)) {
    return res.status(400).json({ error: 'bad_input' });
  }
  try {
    const pack = await db.one('SELECT id, coins, bonus FROM packs WHERE id = ? AND active = 1', [packId]);
    if (!pack) return res.status(400).json({ error: 'unknown_pack' });
    const already = await db.one('SELECT id FROM bot_mints WHERE order_ref = ?', [orderRef]);
    if (already) return res.status(409).json({ error: 'already_minted' });

    const admin = await db.one("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (!admin) return res.status(503).json({ error: 'no_admin' });
    const coinsEach = pack.coins + pack.bonus;

    const out = await db.tx(async (conn) => {
      // Lock the order ref first: a second request for the same order waits here, then fails.
      const [ins] = await conn.query(
        'INSERT IGNORE INTO bot_mints (order_ref, pack_id, coins, code_id, discord_user) VALUES (?, ?, ?, NULL, ?)',
        [orderRef, pack.id, coinsEach, discordUser]);
      if (!ins.affectedRows) return { dup: true };
      const [batch] = await conn.query(
        'INSERT INTO code_batches (reseller_id, label, coins, quantity, created_by) VALUES (NULL, ?, ?, 1, ?)',
        [`Discord order ${orderRef}`, coinsEach, admin.id]);
      let code;
      let codeId;
      for (let i = 0; i < 5 && !codeId; i++) {
        code = codes.makeCode('');
        const [r] = await conn.query('INSERT IGNORE INTO codes (batch_id, code_hash, hint) VALUES (?, ?, ?)',
          [batch.insertId, codes.hash(code), `…${code.slice(-4)}`]);
        if (r.affectedRows) codeId = r.insertId;
      }
      if (!codeId) throw new Error('could not create a unique code');
      await conn.query('UPDATE bot_mints SET code_id = ? WHERE id = ?', [codeId, ins.insertId]);
      await conn.query('INSERT INTO admin_log (admin_id, action, detail) VALUES (?, ?, ?)',
        [admin.id, 'bot.mint', `order ${orderRef}, pack ${pack.id}, ${coinsEach} GP, code …${code.slice(-4)}`]);
      return { code, coins: coinsEach };
    });
    if (out.dup) return res.status(409).json({ error: 'already_minted' });
    res.json({ code: out.code, coins: out.coins, hint: `…${out.code.slice(-4)}` });
  } catch (err) {
    log.requestError(req, err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = { router, sign };
