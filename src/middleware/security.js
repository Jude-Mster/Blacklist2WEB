'use strict';
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

/** Per-session CSRF token, checked on every non-GET request (field _csrf or header x-csrf-token). */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const a = Buffer.from(String(sent));
  const b = Buffer.from(req.session.csrf);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('pages/error', { title: 'Session expired', message: 'Your form expired. Go back, reload the page and try again.' });
  }
  next();
}

const limiter = (windowMin, max, message) => rateLimit({
  windowMs: windowMin * 60 * 1000,
  limit: max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('pages/error', { title: 'Slow down', message }),
});

module.exports = {
  csrf,
  loginLimiter: limiter(15, 10, 'Too many login attempts. Wait 15 minutes and try again.'),
  registerLimiter: limiter(60, 5, 'Too many accounts created from your network. Try again later.'),
  redeemLimiter: limiter(10, 8, 'Too many code attempts. Wait 10 minutes and try again.'),
  orderLimiter: limiter(10, 10, 'Too many orders. Wait a few minutes and try again.'),
  mailLimiter: limiter(60, 5, 'Too many emails sent. Wait an hour and try again.'),
  passwordLimiter: limiter(15, 6, 'Too many password attempts. Wait 15 minutes and try again.'),
  globalLimiter: limiter(1, 300, 'Too many requests. Slow down and try again in a minute.'),
};
