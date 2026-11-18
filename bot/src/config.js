'use strict';
// All settings come from bot/.env (never committed). See .env.example.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const env = (k, d = '') => (process.env[k] ?? d).trim();
const SNOWFLAKE = /^\d{17,20}$/;

const cfg = {
  token: env('DISCORD_TOKEN'),
  appId: env('DISCORD_APP_ID'),
  guildId: env('GUILD_ID'),
  ownerId: env('OWNER_ID'),
  ordersCategoryId: env('ORDERS_CATEGORY_ID'),
  logChannelId: env('LOG_CHANNEL_ID'), // optional: copies of approvals/rejections for staff
  siteUrl: env('SITE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  apiSecret: env('BOT_API_SECRET'),
  maxProofBytes: 8 * 1024 * 1024,
  maxOrdersPerDay: Number(env('MAX_ORDERS_PER_DAY', '5')),
  methods: ['GCash', 'Maya', 'PayNow', 'GrabPay', 'TrueMoney', 'PromptPay', 'DANA', 'OVO', 'GoPay', 'Wise'],
};

function check() {
  const missing = [];
  if (!cfg.token) missing.push('DISCORD_TOKEN');
  for (const k of ['appId', 'guildId', 'ownerId', 'ordersCategoryId']) if (!SNOWFLAKE.test(cfg[k])) missing.push(k);
  if (cfg.logChannelId && !SNOWFLAKE.test(cfg.logChannelId)) missing.push('LOG_CHANNEL_ID');
  if (cfg.apiSecret.length < 32) missing.push('BOT_API_SECRET (32+ characters, same as the website)');
  if (!/^https?:\/\//.test(cfg.siteUrl)) missing.push('SITE_URL');
  return missing;
}

module.exports = { cfg, check };
