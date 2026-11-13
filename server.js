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
const { globalLimiter } = require('./src/middleware/security');
const { sameOrigin } = require('./src/middleware/origin');
const log = require('./src/log');

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
// Health check: details only outside production (setup problems are printed to the server log).
app.get('/healthz', (req, res) => res.json(config.isProd ? { ok: true } : { ok: true, comingSoon: config.comingSoon, db: dbReady, problems: config.problems }));
app.use(globalLimiter);

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

// Coming Soon for ordinary visitors is served before sessions and the database, so it works
// even while the database is not set up. Visitors with a login cookie go on to the full check.
app.use(require('./src/middleware/comingSoon').earlyComingSoon);

app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 50 }));
app.use(sameOrigin);

const sessionStore = new MySQLStore({ createDatabaseTable: true, clearExpired: true }, db.pool);
let dbReady = false;
sessionStore.onReady().then(() => { dbReady = true; }).catch((e) => console.error('Database not reachable:', log.clean(e.message)));
app.use(session({
  name: 'b2sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 14 * 24 * 3600 * 1000 },
}));


app.use(flash);
app.use((req, res, next) => { loadUser(req, res, next).catch(next); });
app.use(async (req, res, next) => {
  try { res.locals.status = await game.statusCached(); } catch { /* keep offline */ }
  next();
});
app.use(csrf);
app.use(require('./src/middleware/comingSoon').comingSoon);

app.use('/', require('./src/routes/public'));
app.use('/', require('./src/routes/auth'));
app.use('/account', require('./src/routes/account'));
app.use('/recharge', require('./src/routes/recharge'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => res.status(404).render('pages/error', { title: 'Not found', message: 'This page does not exist.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log.requestError(req, err);
  res.status(500).render('pages/error', { title: 'Something went wrong', message: 'An error happened on our side. Please try again in a minute.' });
});

/** Accounts listed in ADMIN_ACCOUNTS (comma-separated) get the admin role. */
async function syncAdmins() {
  const ids = String(process.env.ADMIN_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length) await db.run("UPDATE users SET role = 'admin' WHERE account_id IN (?)", [ids]);
}

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', log.clean(e && e.message ? e.message : e)));

if (require.main === module) {
  // Always start listening first, so the site (at least the Coming Soon page) is up even when
  // the database is not ready yet. Database setup runs right after and retries every minute.
  app.listen(config.port, () => {
    console.log(`Blacklist2WEB listening on :${config.port} (game API: ${config.game.mode}, coming soon: ${config.comingSoon})`);
    config.problems.forEach((p) => console.warn('SETUP:', p));
  });
  const setup = () => require('./scripts/migrate').migrate()
    .then(syncAdmins)
    .then(() => { dbReady = true; return true; })
    .catch((e) => { console.error('Database setup failed (will retry in 60 s):', log.clean(e.message)); return false; });
  setup().then((ok) => {
    const timer = setInterval(async () => {
      if (!dbReady && !(await setup())) return;
      syncAdmins().catch(() => {});
    }, 60_000);
    timer.unref();
    if (ok) syncAdmins().catch(() => {});
  });
}

module.exports = app;
