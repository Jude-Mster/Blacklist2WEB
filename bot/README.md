# Blacklist2 GP bot

A small Discord bot that sells GP codes with your approval:

1. The buyer presses **Buy GP** in #gp-codes and fills one form: pack, payment method, in-game
   account, reference number and a **screenshot of the payment**.
2. The bot opens a private `#order-NNNN` channel (only the buyer, you and the bot can see it) and
   **DMs you** the screenshot with **Approve & send code** / **Reject** buttons.
3. You check your GCash / Maya / Wise… app for the payment, then press **Approve**. The website
   creates one single-use code and the bot posts it in the buyer's private channel (and DMs it).

Packs and prices come from the website (**Admin › Packs**), so the site and Discord always match.

## Safety

- Only `OWNER_ID` can approve, reject or post the panel.
- The website only creates a code for a request signed with `BOT_API_SECRET`, less than 5 minutes old,
  and **never twice for the same order** (even if you double-click).
- Screenshots are checked by their bytes (PNG/JPG/WebP only, 8 MB max), kept in memory only and never saved.
- One open order per buyer, at most `MAX_ORDERS_PER_DAY` per day.
- Codes are never written to the bot's files or logs, only their last 4 characters.
- A screenshot can be faked: **always confirm the money arrived in your account before approving.**

## Setup (Windows PC, for testing)

1. **Node.js 20+** from nodejs.org.
2. **Create the bot** at <https://discord.com/developers/applications> › *New Application* (name it
   "Blacklist2"). Copy the **Application ID**. Under *Bot* press **Reset Token** and copy the token.
   No privileged intents are needed.
3. **Invite it** (replace `APP_ID`):
   `https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot%20applications.commands&permissions=268553232`
   (View Channels, Send Messages, Embed Links, Attach Files, Read History, Manage Channels, Manage Roles).
4. **Secret:** make one random 48-character value, e.g. in PowerShell:
   `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})`.
   Put it in the website's environment as `BOT_API_SECRET` (Hostinger › your Node app › Environment
   variables, then restart) **and** in `bot/.env`.
5. In this `bot` folder: copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `DISCORD_APP_ID`,
   `BOT_API_SECRET` (the server, channel and owner IDs are already filled in).
6. Install and start:

   ```
   cd bot
   npm install
   npm run register
   npm start
   ```

7. In Discord, go to **#gp-codes** and type `/gp-panel`. The **Buy GP** button appears.
8. Test once yourself with a cheap pack, then remove the Ticket Tool panel.

The bot only works while `npm start` is running. To keep it online 24/7 later, run the same
folder on the Singapore server (for example with `pm2 start src/index.js --name gp-bot`).

## Files

- `src/index.js` – the order flow
- `src/api.js` – signed calls to the website (`/internal/bot/packs`, `/internal/bot/mint`)
- `src/checks.js` – input and screenshot checks
- `src/store.js` – orders in `data/orders.json` (git-ignored)
- `src/register.js` – registers `/gp-panel`
