'use strict';
require('dotenv').config();

const env = (k, d = '') => (process.env[k] ?? d);
const isProd = env('NODE_ENV') === 'production';

// Setup problems are collected instead of crashing, so the Coming Soon page still loads.
const problems = [];

function secret(name) {
  const v = env(name);
  if (!v || v.startsWith('change-me') || v.length < 32) {
    if (isProd) problems.push(`${name} is missing or shorter than 32 characters`);
    return null;
  }
  return v;
}

const sessionSecretValue = secret('SESSION_SECRET');
const codePepperValue = secret('CODE_PEPPER');

module.exports = {
  isProd,
  port: Number(env('PORT', '3000')),
  siteUrl: env('SITE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  siteName: env('SITE_NAME', 'Blacklist TS2 Online'),
  // On by default: visitors see only the Coming Soon page (admins still see the whole site).
  comingSoon: env('COMING_SOON', 'true').toLowerCase() !== 'false',
  // Optional launch time for the countdown, e.g. 2026-12-20T20:00:00+08:00
  launchDate: env('LAUNCH_DATE'),
  problems,
  // Without SESSION_SECRET a random one is used: the site works, but logins reset on restart.
  sessionSecret: sessionSecretValue || require('crypto').randomBytes(32).toString('hex'),
  // Without CODE_PEPPER codes are switched off (a random pepper would break saved codes).
  codePepper: codePepperValue || (isProd ? null : 'dev-only-CODE_PEPPER'),
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
