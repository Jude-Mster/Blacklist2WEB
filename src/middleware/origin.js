'use strict';
// CORS stays closed: the site sends no Access-Control-Allow-* headers, so other sites cannot
// read its responses. On top of the CSRF token, a form post or other state change coming
// from another site's page (Origin / Referer of a different host) is refused outright.
const config = require('../config');

let ownOrigin;
try { ownOrigin = new URL(config.siteUrl).origin; } catch { ownOrigin = null; }

function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.method === 'OPTIONS') return res.status(204).end(); // no CORS preflight approval
    return next();
  }
  const origin = req.get('origin');
  const referer = req.get('referer');
  let from = null;
  if (origin && origin !== 'null') from = origin;
  else if (referer) { try { from = new URL(referer).origin; } catch { from = 'bad'; } }
  if (!from) return next(); // non-browser client: the CSRF token still applies
  const host = `${req.protocol}://${req.get('host')}`;
  if (from === host || from === ownOrigin) return next();
  return res.status(403).send('Cross-site request refused.');
}

module.exports = { sameOrigin };
