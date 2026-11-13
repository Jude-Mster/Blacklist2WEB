'use strict';
const express = require('express');
const config = require('../config');
const db = require('../db');
const orders = require('../services/orders');
const codes = require('../services/codes');
const { requireUser, requireVerified } = require('../middleware/auth');
const { redeemLimiter, orderLimiter } = require('../middleware/security');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get('/', wrap(async (req, res) => {
  const packs = await db.all('SELECT * FROM packs WHERE active = 1 ORDER BY sort, price_php');
  const resellers = await db.all('SELECT name, country, contact, methods, prefix FROM resellers WHERE visible = 1 ORDER BY country, name');
  res.render('pages/recharge', { title: 'Recharge', packs, resellers });
}));

router.post('/order', requireUser, requireVerified, orderLimiter, wrap(async (req, res) => {
  const r = await orders.create(req.user, Number(req.body.packId) || 0);
  if (r.error) { req.flash('error', r.error); return res.redirect('/recharge'); }
  res.redirect(`/recharge/order/${r.orderNo}`);
}));

router.get('/order/:no', requireUser, wrap(async (req, res, next) => {
  await orders.expireOld();
  const order = await db.one('SELECT * FROM orders WHERE order_no = ? AND user_id = ?', [req.params.no, req.user.id]);
  if (!order) return next();
  res.render('pages/order', { title: `Order ${order.order_no}`, order, gcash: config.gcash });
}));

router.post('/order/:no/reference', requireUser, requireVerified, orderLimiter, wrap(async (req, res) => {
  const r = await orders.submitReference(req.user, req.params.no, req.body.reference);
  if (r.error) req.flash('error', r.error);
  else req.flash('ok', 'Thanks! We will check the payment and add your coins, usually within a few hours.');
  res.redirect(`/recharge/order/${encodeURIComponent(req.params.no)}`);
}));

router.post('/redeem', requireUser, requireVerified, redeemLimiter, wrap(async (req, res) => {
  const r = await codes.redeem(req.user, req.body.code);
  if (r.error) req.flash('error', r.error);
  else if (r.delivered) req.flash('ok', `Code accepted: ${r.coins.toLocaleString('en-US')} coins added to your Item Mall balance.`);
  else req.flash('ok', `Code accepted for ${r.coins.toLocaleString('en-US')} coins. The game server is busy, so they will arrive shortly.`);
  res.redirect('/recharge#redeem');
}));

module.exports = router;
