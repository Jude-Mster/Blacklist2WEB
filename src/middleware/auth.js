'use strict';
const db = require('../db');

/** Loads the signed-in user (if any) into req.user and res.locals.user. */
async function loadUser(req, res, next) {
  req.user = null;
  if (req.session.userId) {
    const u = await db.one('SELECT id, account_id, email, role, banned, created_at FROM users WHERE id = ?', [req.session.userId]);
    if (u && !u.banned) req.user = u;
    else delete req.session.userId;
  }
  res.locals.user = req.user;
  next();
}

function requireUser(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(404).render('pages/error', { title: 'Not found', message: 'This page does not exist.' });
}

module.exports = { loadUser, requireUser, requireAdmin };
