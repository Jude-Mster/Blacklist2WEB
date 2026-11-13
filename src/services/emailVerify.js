'use strict';
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const mailer = require('./mailer');

const TTL_HOURS = 24;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Creates a fresh token for user + email (older unused ones stop working) and mails the link. */
async function sendLink(user, email) {
  await db.run('UPDATE email_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run(
    'INSERT INTO email_tokens (user_id, email, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))',
    [user.id, email, sha(token), TTL_HOURS]);
  const link = `${config.siteUrl}/verify-email?token=${token}`;
  return mailer.send({
    to: email,
    subject: `Confirm your email for ${config.siteName}`,
    text: `Hi ${user.account_id},\n\nConfirm your email by opening this link within ${TTL_HOURS} hours:\n${link}\n\nIf you did not create this account, ignore this email.`,
    html: `<p>Hi ${escapeHtml(user.account_id)},</p><p>Confirm your email for ${escapeHtml(config.siteName)} by clicking the button below within ${TTL_HOURS} hours.</p>`
      + `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;background:#c8141c;color:#fff;text-decoration:none;border-radius:4px">Confirm email</a></p>`
      + '<p style="color:#666;font-size:13px">If you did not create this account, ignore this email.</p>',
  });
}

/** Marks the email as verified. Returns the user id, or null when the token is bad or old. */
async function confirm(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return db.tx(async (conn) => {
    const [rows] = await conn.query(
      'SELECT * FROM email_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE', [sha(token)]);
    const t = rows[0];
    if (!t) return null;
    await conn.query('UPDATE email_tokens SET used_at = NOW() WHERE id = ?', [t.id]);
    try {
      await conn.query('UPDATE users SET email = ?, email_verified_at = NOW() WHERE id = ?', [t.email, t.user_id]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return null; // someone else verified that address meanwhile
      throw e;
    }
    return t.user_id;
  });
}

module.exports = { sendLink, confirm };
