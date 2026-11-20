'use strict';
// Signed calls to the website's /internal/bot API. Signature: HMAC-SHA256 over
// "timestamp.METHOD.path.body" with BOT_API_SECRET (the website checks the same string).
const crypto = require('crypto');
const { cfg } = require('./config');

function sign(secret, ts, method, path, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}.${method}.${path}.${body}`).digest('hex');
}

async function call(method, path, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(cfg.siteUrl + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-b2-timestamp': ts,
      'x-b2-signature': sign(cfg.apiSecret, ts, method, path, body),
    },
    body: method === 'GET' ? undefined : body,
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

let packCache = { at: 0, packs: [] };

/** Active packs from the website, cached for 5 minutes. */
async function packs() {
  if (Date.now() - packCache.at < 5 * 60 * 1000 && packCache.packs.length) return packCache.packs;
  const r = await call('GET', '/internal/bot/packs');
  if (r.status !== 200 || !Array.isArray(r.json?.packs)) throw new Error(`packs: HTTP ${r.status}`);
  packCache = { at: Date.now(), packs: r.json.packs };
  return packCache.packs;
}

/** Mints one code for an order. Returns {code, coins, hint} or {error}. */
async function mint(orderRef, packId, discordUser) {
  const r = await call('POST', '/internal/bot/mint', { orderRef, packId, discordUser });
  if (r.status === 200 && r.json?.code) return r.json;
  return { error: r.json?.error || `http_${r.status}` };
}

module.exports = { sign, packs, mint };
