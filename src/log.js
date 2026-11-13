'use strict';
// Logging that keeps sensitive data out: no query strings (tokens), no request bodies
// (passwords, codes, references), no SQL text or values, no emails.

const EMAIL_RE = /[^\s@'"<>]+@[^\s@'"<>]+\.[A-Za-z]{2,}/g;

function clean(text) {
  return String(text || '')
    .replace(EMAIL_RE, '[email]')
    .replace(/'[^']*'/g, "'…'") // values quoted in DB messages, e.g. Duplicate entry '…'
    .replace(/\b(token|password|secret|code|key)=([^&\s]+)/gi, '$1=[hidden]')
    .slice(0, 300);
}

/** Logs an error with the request's method and path only (never the query or body). */
function requestError(req, err) {
  const where = req ? `${req.method} ${req.path}` : '-';
  const code = err && (err.code || err.name) ? ` ${err.code || err.name}` : '';
  console.error(`${new Date().toISOString()} ERROR ${where}${code}: ${clean(err && err.message)}`);
  if (err && err.stack && process.env.NODE_ENV !== 'production') {
    console.error(clean(err.stack.split('\n').slice(1, 4).join(' | ')));
  }
}

module.exports = { clean, requestError };
