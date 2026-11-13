'use strict';
// Signature checks for payment webhooks (HitPay, NOWPayments...). Every webhook route must:
//   1. read the RAW body (express.raw) — never re-serialised JSON,
//   2. verify the signature with verifyHmac() before trusting anything in it,
//   3. re-check the amount/currency/status against the order stored in our database,
//   4. be idempotent (a provider may send the same event more than once).
const crypto = require('crypto');

/**
 * Constant-time HMAC check. algo e.g. 'sha256' or 'sha512'; signature as hex.
 * Returns false (never throws) on any missing or malformed input.
 */
function verifyHmac({ secret, payload, signature, algo = 'sha256' }) {
  if (!secret || !signature || payload == null) return false;
  const expected = crypto.createHmac(algo, secret).update(payload).digest('hex');
  const a = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { verifyHmac };
