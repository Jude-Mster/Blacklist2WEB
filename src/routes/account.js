'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const game = require('../game');
const { requireUser } = require('../middleware/auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireUser);

router.get('/', wrap(async (req, res) => {
  let characters = null;
  let balance = null;
  try {
    [characters, balance] = await Promise.all([game.characters(req.user.account_id), game.coinBalance(req.user.account_id)]);
  } catch { /* game offline: show what the website knows */ }
  const orders = await db.all(
    'SELECT order_no, coins, amount_php, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.user.id]);
  const credits = await db.all(
    'SELECT source, coins, status, created_at FROM coin_credits WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.user.id]);
  res.render('pages/account', { title: 'My account', characters, balance, orders, credits });
}));

router.post('/password', wrap(async (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.password || '');
  const u = await db.one('SELECT pass_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(current, u.pass_hash))) { req.flash('error', 'Your current password is wrong.'); return res.redirect('/account#security'); }
  if (next.length < 8 || next.length > 32) { req.flash('error', 'New password must be 8–32 characters.'); return res.redirect('/account#security'); }
  if (next !== String(req.body.password2 || '')) { req.flash('error', 'The new passwords do not match.'); return res.redirect('/account#security'); }
  try { await game.setPassword(req.user.account_id, next); } catch (e) {
    req.flash('error', e.code === 'unreachable' ? 'The game server is offline. Try again later.' : e.message);
    return res.redirect('/account#security');
  }
  await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', [await bcrypt.hash(next, 12), req.user.id]);
  req.flash('ok', 'Password changed for the website and the game.');
  res.redirect('/account#security');
}));

router.post('/unstuck', wrap(async (req, res) => {
  const name = String(req.body.character || '').slice(0, 16);
  try {
    await game.unstuck(req.user.account_id, name);
    req.flash('ok', `${name} was moved to your faction capital.`);
  } catch (e) {
    req.flash('error', e.code === 'online' ? 'Log out of the game first, then try again.' : e.message);
  }
  res.redirect('/account');
}));

module.exports = router;
