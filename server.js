'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');

const config = require('./src/config');
const db = require('./src/db');
const game = require('./src/game');
const { csrf } = require('./src/middleware/security');
const { loadUser } = require('./src/middleware/auth');
const { flash } = require('./src/services/flash');

const app = express();
app.set('trust proxy', 1); // Hostinger serves the app behind a proxy
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://challenges.cloudflare.com'],
      'frame-src': ['https://challenges.cloudflare.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
    },
  },
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use(session({
  name: 'b2sid',
  secret: config.sessionSecret,
  store: new MySQLStore({ createDatabaseTable: true, clearExpired: true }, db.pool),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 14 * 24 * 3600 * 1000 },
}));

// Values every page needs (set first, so even error pages can render)
app.use((req, res, next) => {
  res.locals.site = { name: config.siteName, url: config.siteUrl, links: config.links };
  res.locals.path = req.path;
  res.locals.status = { online: false, players: null };
  res.locals.user = null;
  res.locals.flashes = [];
  res.locals.csrf = '';
  next();
});
app.use(flash);
app.use((req, res, next) => { loadUser(req, res, next).catch(next); });
app.use(async (req, res, next) => {
  try { res.locals.status = await game.statusCached(); } catch { /* keep offline */ }
  next();
});
app.use(csrf);

app.use('/', require('./src/routes/public'));
app.use('/', require('./src/routes/auth'));
app.use('/account', require('./src/routes/account'));
app.use('/recharge', require('./src/routes/recharge'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => res.status(404).render('pages/error', { title: 'Not found', message: 'This page does not exist.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(new Date().toISOString(), req.method, req.originalUrl, err);
  res.status(500).render('pages/error', { title: 'Something went wrong', message: 'An error happened on our side. Please try again in a minute.' });
});

/** Accounts listed in ADMIN_ACCOUNTS (comma-separated) get the admin role. */
async function syncAdmins() {
  const ids = String(process.env.ADMIN_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length) await db.run("UPDATE users SET role = 'admin' WHERE account_id IN (?)", [ids]);
}

if (require.main === module) {
  require('./scripts/migrate').migrate()
    .then(syncAdmins)
    .then(() => {
      setInterval(() => syncAdmins().catch(() => {}), 60_000).unref();
      app.listen(config.port, () => console.log(`Blacklist2WEB listening on :${config.port} (game API: ${config.game.mode})`));
    })
    .catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
}

module.exports = app;
