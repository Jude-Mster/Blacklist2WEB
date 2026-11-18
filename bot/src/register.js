'use strict';
// Registers the bot's slash command in your server (run once, and again if commands change):
//   npm run register
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { cfg, check } = require('./config');

const missing = check();
if (missing.length) {
  console.error(`Fill these in bot/.env first: ${missing.join(', ')}`);
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('gp-panel')
    .setDescription('Post the "Buy GP" button in this channel (owner only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
].map((c) => c.toJSON());

new REST().setToken(cfg.token)
  .put(Routes.applicationGuildCommands(cfg.appId, cfg.guildId), { body: commands })
  .then(() => console.log('Slash command /gp-panel registered.'))
  .catch((e) => { console.error(`Could not register: ${e.message}`); process.exit(1); });
