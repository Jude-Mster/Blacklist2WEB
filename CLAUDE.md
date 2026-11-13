# Blacklist2WEB — rules for every change

Website for the Blacklist TS2 Online private server (Node 20+, Express 5, EJS, MySQL on
Hostinger). Read README.md for how it runs and docs/GAME_API.md for the game link.

## Security checklist (Jude's standing rule — check EVERY change against it)

| # | Rule | How it is done here |
|---|---|---|
| 1 | Row-level access (RLS) | MySQL has no RLS, so every query on player data filters by the signed-in `req.user.id` on the server (orders, credits, codes, tokens). The DB user is limited to this one database. If Supabase/Postgres is ever used, enable RLS on every table. |
| 2 | Tight CORS | No `Access-Control-Allow-*` headers anywhere. `src/middleware/origin.js` refuses state changes from another site. Never add `cors()` with `*`. |
| 3 | Parameterized SQL | Only `?` placeholders through `src/db.js`. Never build SQL from user input with template strings or `+`. |
| 4 | Verify email | `src/services/emailVerify.js`: hashed one-time tokens, 24 h. Recharge, codes and password changes need `requireVerified`. |
| 5 | No tokens in localStorage | Sessions are httpOnly, SameSite=Lax, Secure cookies. Never put tokens, session ids or secrets in localStorage, sessionStorage or JS-readable cookies. |
| 6 | `.env` out of Git | `.env` is in `.gitignore`; only `.env.example` (no real values) is committed. |
| 7 | Validate form inputs | Check type, length and format on the server for every field (regexes in the routes; ints via `int()`); limit body size (64 kB, 50 fields). |
| 8 | Protect admin routes | `/admin` uses `requireAdmin` (role from the DB), answers 404 to everyone else, `no-store`, `noindex`, every action is written to `admin_log`. |
| 9 | No production debugging | `NODE_ENV=production`: error pages never show stacks or messages; `/healthz` shows no details; no debug routes. |
| 10 | Secrets server-side | API keys and secrets only in env vars read by `src/config.js`. Nothing secret in `views/` or `public/`. |
| 11 | Security scans | `.github/workflows/security-review.yml` runs anthropics/claude-code-security-review on pull requests (needs the `CLAUDE_API_KEY` repo secret). Work on a branch + PR for anything security-related. |
| 12 | Rate limiting | Global 300/min/IP plus per-route limits (login, register, password, redeem, orders, emails) in `src/middleware/security.js`. New sensitive routes get their own limiter. |
| 13 | Validate file uploads | There are no uploads yet. If one is added: allow-list types by content (magic bytes, not the name), size limit, random server-side filename, store outside `public/` or on object storage, never execute or serve with the user's type. |
| 14 | No sensitive data in logs | Use `src/log.js` (`requestError`, `clean`): no query strings, bodies, passwords, codes, tokens, emails or SQL values. Never `console.log(req.body)`. |
| 15 | Hash passwords | bcrypt cost 12. Game passwords are the game server's job (see GAME_API.md rule 1). |
| 16 | Verify webhook signatures | `src/services/webhooks.js` `verifyHmac` on the raw body, then re-check the amount against our own order, idempotently. |
| 17 | Server-side permissions | Never trust a hidden field or client-side check: look up ownership and role in the DB on every request. |
| 18 | Block XSS | EJS `<%= %>` escapes; `<%-` only for includes and constant SVG. Strict CSP in `server.js` (no inline scripts). Links from data must be `http(s)://` only. |
| 19 | Update dependencies | `npm audit` must show 0 vulnerabilities before each push; Dependabot (`.github/dependabot.yml`) opens weekly update PRs. |

Also: CSRF token on every form (`_csrf`), `npm test` must pass before pushing (needs MySQL), and
keep commit messages in plain language.
