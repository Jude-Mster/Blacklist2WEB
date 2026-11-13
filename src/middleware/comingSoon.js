'use strict';
const config = require('../config');

// Paths that keep working while the site is in Coming Soon mode, so staff can log in and
// use the admin panel, and the page can load its own files.
const OPEN = [/^\/login$/, /^\/logout$/, /^\/admin(\/|$)/, /^\/css\//, /^\/img\//, /^\/js\//, /^\/favicon/];

function comingSoon(req, res, next) {
  if (!config.comingSoon) return next();
  if (req.user && req.user.role === 'admin') return next();
  if (OPEN.some((re) => re.test(req.path))) return next();
  if (req.path !== '/') return res.redirect(302, '/');
  res.set('Cache-Control', 'no-store');
  return res.render('pages/coming-soon', {
    launchDate: config.launchDate && !Number.isNaN(Date.parse(config.launchDate)) ? new Date(config.launchDate).toISOString() : '',
  });
}

module.exports = { comingSoon };
