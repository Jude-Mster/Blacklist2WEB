'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db');
const game = require('../game');
const { loginLimiter, registerLimiter } = require('../middleware/security');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const ACCOUNT_RE = /^[A-Za-z0-9]{4,12}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function checkCaptcha(req) {
  if (!config.turnstile.secret) return true;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: config.turnstile.secret, response: req.body['cf-turnstile-response'] || '', remoteip: req.ip }),
      signal: AbortSignal.timeout(6000),
    });
    return (await r.json()).success === true;
  } catch { return false; }
}

function signIn(req, user) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => {
    if (err) return reject(err);
    req.session.userId = user.id;
    resolve();
  }));
}

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('pages/register', { title: 'Create account', form: {}, errors: [], turnstileKey: config.turnstile.siteKey });
});

router.post('/register', registerLimiter, wrap(async (req, res) => {
  const form = {
    accountId: String(req.body.accountId || '').trim(),
    email: String(req.body.email || '').trim().toLowerCase(),
    referral: String(req.body.referral || '').trim().slice(0, 32),
  };
  const password = String(req.body.password || '');
  const errors = [];
  if (!ACCOUNT_RE.test(form.accountId)) errors.push('Account ID must be 4–12 letters or numbers.');
  if (!EMAIL_RE.test(form.email)) errors.push('Enter a valid email address.');
  if (password.length < 8 || password.length > 32) errors.push('Password must be 8–32 characters.');
  if (password !== String(req.body.password2 || '')) errors.push('The two passwords do not match.');
  if (!req.body.terms) errors.push('You need to accept the rules, terms and refund policy.');
  if (!errors.length && !(await checkCaptcha(req))) errors.push('Captcha check failed. Try again.');

  if (!errors.length) {
    const taken = await db.one('SELECT account_id, email FROM users WHERE account_id = ? OR email = ?', [form.accountId, form.email]);
    if (taken && taken.account_id.toLowerCase() === form.accountId.toLowerCase()) errors.push('That account ID is taken.');
    else if (taken) errors.push('That email is already registered.');
  }
  if (!errors.length) {
    try {
      if (await game.accountExists(form.accountId)) errors.push('That account ID is taken.');
      else await game.createAccount(form.accountId, password);
    } catch (e) {
      errors.push(e.code === 'account_exists' ? 'That account ID is taken.'
        : e.code === 'unreachable' ? 'The game server is offline, so accounts cannot be created right now. Try again later.'
          : e.message);
    }
  }
  if (errors.length) {
    return res.status(400).render('pages/register', { title: 'Create account', form, errors, turnstileKey: config.turnstile.siteKey });
  }
  const hash = await bcrypt.hash(password, 12);
  const r = await db.run(
    'INSERT INTO users (account_id, email, pass_hash, referral_code, last_login_at, last_ip) VALUES (?, ?, ?, ?, NOW(), ?)',
    [form.accountId, form.email, hash, form.referral || null, req.ip]);
  await signIn(req, { id: r.insertId });
  req.flash('ok', 'Welcome to Blacklist TS2! Your account works on both PC and Android.');
  res.redirect('/account');
}));

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('pages/login', { title: 'Log in', accountId: '', error: null });
});

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const accountId = String(req.body.accountId || '').trim();
  const password = String(req.body.password || '');
  const fail = (msg) => res.status(401).render('pages/login', { title: 'Log in', accountId, error: msg });
  if (!ACCOUNT_RE.test(accountId) || !password) return fail('Wrong account ID or password.');

  let user = await db.one('SELECT * FROM users WHERE account_id = ?', [accountId]);
  if (user) {
    if (!(await bcrypt.compare(password, user.pass_hash))) return fail('Wrong account ID or password.');
  } else {
    // An account made in game before the website existed: check it with the game, then link it.
    let valid = false;
    try { valid = await game.verifyLogin(accountId, password); } catch { return fail('The game server is offline, so first-time logins cannot be checked right now.'); }
    if (!valid) return fail('Wrong account ID or password.');
    const hash = await bcrypt.hash(password, 12);
    const r = await db.run('INSERT INTO users (account_id, pass_hash) VALUES (?, ?)', [accountId, hash]);
    user = await db.one('SELECT * FROM users WHERE id = ?', [r.insertId]);
  }
  if (user.banned) return fail('This account is banned. Contact support on Discord.');
  await db.run('UPDATE users SET last_login_at = NOW(), last_ip = ? WHERE id = ?', [req.ip, user.id]);
  const back = req.session.returnTo;
  await signIn(req, user);
  res.redirect(back && back.startsWith('/') && !back.startsWith('//') ? back : '/account');
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
