'use strict';
require('dotenv').config();

const env = (k, d = '') => (process.env[k] ?? d);
const isProd = env('NODE_ENV') === 'production';

function requireSecret(name) {
  const v = env(name);
  if (isProd && (!v || v.startsWith('change-me') || v.length < 32)) {
    throw new Error(`${name} must be set to a random string of 32+ characters in production`);
  }
  return v || `dev-only-${name}`;
}

module.exports = {
  isProd,
  port: Number(env('PORT', '3000')),
  siteUrl: env('SITE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  siteName: env('SITE_NAME', 'Blacklist TS2 Online'),
  sessionSecret: requireSecret('SESSION_SECRET'),
  codePepper: requireSecret('CODE_PEPPER'),
  db: {
    host: env('DB_HOST', '127.0.0.1'),
    port: Number(env('DB_PORT', '3306')),
    user: env('DB_USER', 'root'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME', 'blacklist2web'),
  },
  game: {
    mode: env('GAME_API_MODE', 'mock'),
    url: env('GAME_API_URL').replace(/\/$/, ''),
    secret: env('GAME_API_SECRET'),
  },
  gcash: {
    name: env('GCASH_NAME'),
    number: env('GCASH_NUMBER'),
    qr: env('GCASH_QR'),
    orderTtlMinutes: Number(env('ORDER_TTL_MINUTES', '60')),
  },
  turnstile: { siteKey: env('TURNSTILE_SITE_KEY'), secret: env('TURNSTILE_SECRET') },
  links: {
    discord: env('DISCORD_URL', '#'),
    facebook: env('FACEBOOK_URL', '#'),
    telegram: env('TELEGRAM_URL', '#'),
    pc: env('DOWNLOAD_PC_URL', '#'),
    pcMirror: env('DOWNLOAD_PC_MIRROR_URL', '#'),
    android: env('DOWNLOAD_ANDROID_URL', '#'),
    androidMirror: env('DOWNLOAD_ANDROID_MIRROR_URL', '#'),
    email: env('CONTACT_EMAIL'),
  },
};
