# Blacklist2WEB

Website for **Blacklist TS2 Online**, a TwelveSky 2 private server for PC and Android.
Node.js + Express with server-rendered pages (EJS), MySQL for the website's own data, and a
signed private API to the game server.

## What's in it

| Area | Pages |
|---|---|
| Public | Home, News, Download (PC + Android), Rankings (level / PK / duels / guilds + factions), Support (FAQ, rules, terms) |
| Accounts | Register (creates the game account), Log in (also links accounts made in game), Account (characters, coins, orders, coin history, change password, unstuck) |
| Recharge | GCash manual orders (exact amount with unique centavos + 13-digit reference), redeem codes, official reseller list |
| Admin `/admin` | Approve/reject GCash orders, coin deliveries (retry, give coins), code batches (create, disable, look up), resellers, coin packs, news, users (ban) |

Security: bcrypt passwords, CSRF tokens on every form, rate limits on login/register/redeem/orders,
Helmet headers + CSP, sessions in MySQL, codes stored only as salted hashes, every coin grant
recorded once and applied once (safe to retry).

## How it connects to the game

The site never touches `ts2_gamedb`. It calls the game server's private HTTPS API, signed with a
shared secret — see **[docs/GAME_API.md](docs/GAME_API.md)**. Until the game side exists, set
`GAME_API_MODE=mock`: a fake in-memory game is used (accounts and coins reset on restart).

## Run locally

```bash
cp .env.example .env      # fill in DB_* and set NODE_ENV=development
npm install
npm start                 # creates/updates the tables, then serves http://localhost:3000
npm test                  # end-to-end test (needs the DB from .env)
```

## Deploy on Hostinger (Web App)

1. **Database**: hPanel → Databases → MySQL → create a database and user. Note host, name, user, password.
2. **Web App**: Websites → Create site → **Web App** → connect GitHub → `Jude-Mster/Blacklist2WEB`, branch `main`.
   - Framework / preset: Express (or "Other" Node.js)
   - Node version: 20 or newer
   - Build command: `npm install`
   - Start command / entry file: `npm start` / `server.js`
3. **Environment variables**: copy every line of `.env.example` and fill it in. Generate the two
   secrets with any password generator (40+ random characters). Keep `NODE_ENV=production`.
4. Deploy. The tables are created automatically on first start.
5. **Domain**: point `blacklist2.com` at the web app in hPanel and turn on SSL.
6. **Admin**: register (or log in) on the site with your game account, then put that account ID in
   `ADMIN_ACCOUNTS` and redeploy. `/admin` appears in the header.
7. **GCash**: set `GCASH_NAME`, `GCASH_NUMBER`, and optionally upload a QR image to `public/img/`
   and set `GCASH_QR=/img/your-qr.png`.

Every push to `main` redeploys the site.

## Placeholders to fill in

Server rates, max level and download sizes on the home and download pages are shown as `[x]`
until you set them in `views/pages/home.ejs` and `views/pages/download.ejs`.
