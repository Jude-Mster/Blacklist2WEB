'use strict';
const config = require('../config');

// Paths that keep working while the site is in Coming Soon mode, so staff can log in and
// use the admin panel, and the page can load its own files.
const OPEN = [/^\/login$/, /^\/logout$/, /^\/admin(\/|$)/, /^\/css\//, /^\/img\//, /^\/js\//, /^\/favicon/, /^\/healthz$/];

function render(res) {
  res.set('Cache-Control', 'no-store');
  return res.render('pages/coming-soon', {
    launchDate: config.launchDate && !Number.isNaN(Date.parse(config.launchDate)) ? new Date(config.launchDate).toISOString() : '',
  });
}

function hasSessionCookie(req) {
  return /(?:^|;\s*)b2sid=/.test(req.headers.cookie || '');
}

/**
 * Runs before sessions and the database. Visitors without a login cookie get the Coming Soon
 * page (or a redirect to it) without touching the database at all.
 */
function earlyComingSoon(req, res, next) {
  if (!config.comingSoon) return next();
  if (OPEN.some((re) => re.test(req.path))) return next();
  if (hasSessionCookie(req)) return next(); // may be an admin: decided after the session loads
  if (req.path !== '/') return res.redirect(302, '/');
  return render(res);
}

/** Runs after the user is loaded: admins see the whole site, everyone else the landing page. */
function comingSoon(req, res, next) {
  if (!config.comingSoon) return next();
  if (req.user && req.user.role === 'admin') return next();
  if (OPEN.some((re) => re.test(req.path))) return next();
  if (req.path !== '/') return res.redirect(302, '/');
  return render(res);
}

module.exports = { earlyComingSoon, comingSoon };
