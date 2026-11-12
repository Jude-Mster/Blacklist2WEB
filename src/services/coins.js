'use strict';
const db = require('../db');
const game = require('../game');

/**
 * Grants coins once per (source, sourceId). Records the grant first, then asks the game to
 * apply it with the same id, so retries can never double-pay. Returns the credit row.
 */
async function grant(user, source, sourceId, coins) {
  await db.run(
    'INSERT IGNORE INTO coin_credits (user_id, source, source_id, coins) VALUES (?, ?, ?, ?)',
    [user.id, source, String(sourceId), coins],
  );
  const credit = await db.one('SELECT * FROM coin_credits WHERE source = ? AND source_id = ?', [source, String(sourceId)]);
  if (credit.status === 'done') return credit;
  return apply(credit, user.account_id);
}

async function apply(credit, accountId) {
  try {
    await game.addCoins(accountId, credit.coins, `web-${credit.source}-${credit.source_id}`);
    await db.run("UPDATE coin_credits SET status = 'done', attempts = attempts + 1, last_error = NULL, done_at = NOW() WHERE id = ?", [credit.id]);
    return { ...credit, status: 'done' };
  } catch (e) {
    await db.run("UPDATE coin_credits SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?", [String(e.message).slice(0, 250), credit.id]);
    return { ...credit, status: 'failed', last_error: e.message };
  }
}

/** Retries one failed credit (admin action). */
async function retry(creditId) {
  const row = await db.one(
    'SELECT c.*, u.account_id FROM coin_credits c JOIN users u ON u.id = c.user_id WHERE c.id = ?', [creditId]);
  if (!row || row.status === 'done') return row;
  return apply(row, row.account_id);
}

module.exports = { grant, retry };
