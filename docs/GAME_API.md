# Game API — the private link between the website and the game server

The website never connects to `ts2_gamedb` directly. The game server (Blacklist2.Server, C#)
exposes a small HTTPS API that only the website may call. This file is the contract both
sides follow. Until the game side exists, run the website with `GAME_API_MODE=mock`.

## Transport and security

- HTTPS only, straight to the game server: `https://play.blacklist2.com:29980` (Windows Firewall rule
  "Blacklist2 game api"). The MySQL port stays closed.
- The certificate is the game server's own (ECDSA P-256, 10 years, made at its first start in
  `server\secrets\gameapi\`). The website trusts exactly that certificate: `GAME_API_CA` holds the base64 of
  `gameapi_cert.pem`, and `src/game/index.js` passes it as the only CA. A different certificate, plain `http://` or a
  wrong host name is refused. The private key (`gameapi.pfx`) never leaves the game server.
- Every request carries:
  - `x-b2-timestamp`: Unix seconds.
  - `x-b2-nonce`: 32 random hex digits, new for every request.
  - `x-b2-signature`: hex HMAC-SHA256 of `"{timestamp}.{nonce}.{METHOD}.{path?query}.{rawBody}"`
    with the shared secret `GAME_API_SECRET` (raw body is `""` for GET).
    Test vector: secret `0123456789abcdef0123456789abcdef`, timestamp `1700000000`, nonce
    `00112233445566778899aabbccddeeff`, `POST /v1/accounts`, body `{"accountId":"abcd","password":"pw"}` →
    `d57e75f26732beead956561a468f30d3e7a295899c44c91572873883c4018a9c`.
- The server rejects a request when the signature does not match (constant-time compare), the timestamp is more than
  60 s away from its clock, or the nonce was already used (replay). 20 refused requests from one address in
  10 minutes shut that address out for 10 minutes; any address may make 600 requests a minute.
- Optional: `GameApiAllow` in the game server's `server.config.json` (comma list of the website's outgoing addresses).
- Responses are JSON. Success: `{ "ok": true, ... }`. Failure: HTTP 4xx/5xx with
  `{ "ok": false, "error": "<code>", "message": "<text a player may see>" }`.

### Setting it up (game server side: `Blacklist2.Server`, `GameApi.cs`)

1. Apply the update that carries the Game API, then run `host\gameapi_setup.bat` as Administrator on the game server.
   It adds a random `GameApiSecret` to `server\server.secrets.json`, opens TCP 29980, makes the certificate and writes
   `server\secrets\gameapi\website_env.txt` with the four website settings.
2. Restart the game server. The log shows `[gameapi] https://play.blacklist2.com:29980/v1 ...`.
3. Hostinger → the web app → Environment variables: `GAME_API_MODE=real`, `GAME_API_URL`, `GAME_API_SECRET`,
   `GAME_API_CA` from that file; redeploy; delete the file.
4. Self checks on the game server's PC: `Blacklist2.Server.dll --selftest-gameapi` (transport and signatures) and
   `--selftest-gameapi-db` (every account / coin endpoint with a throw-away account that is removed again).

## Endpoints

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/v1/status` | – | `{ online, players, serverTime }` |
| GET | `/v1/accounts/{accountId}` | – | `{ exists }` |
| POST | `/v1/accounts` | `{ accountId, password }` | `{}` · errors `account_exists`, `invalid_account_id` |
| POST | `/v1/accounts/verify` | `{ accountId, password }` | `{ valid }` |
| POST | `/v1/accounts/password` | `{ accountId, password }` | `{}` · error `no_account` |
| GET | `/v1/accounts/{accountId}/characters` | – | `{ characters: [{ name, faction, level, pk, zone }] }` |
| GET | `/v1/accounts/{accountId}/coins` | – | `{ balance }` |
| POST | `/v1/coins/add` | `{ accountId, coins, creditId }` | `{ balance }` |
| POST | `/v1/characters/unstuck` | `{ accountId, characterName }` | `{}` |
| GET | `/v1/rankings?type=level\|pk\|duel\|guild&limit=50` | – | `{ rows: [{ rank, name, faction, guild, value }] }` |

Notes on the game side today: `characters` also carries `mlevel`; rankings `level` is live (players only, no GM),
`pk`, `duel` and `guild` answer an empty list until the game keeps those counts; factions count the characters of
each faction (`pkKillsWeek` is 0 for now). Passwords are stored as the game login server stores them:
`p2$` PBKDF2-SHA256 of the MD5 the client sends (rule 1 below is done).
| GET | `/v1/factions` | – | `{ factions: [{ name, players, pkKillsWeek }] }` |

### Rules the game side must follow

1. **Passwords**: store and check them exactly the way the game login server does today
   (`memberinfo.uPassword`). If that is plain text, change the login server and this API
   together to a proper hash before launch — the website sends the password only over the signed
   HTTPS call and never stores it in plain text itself.
2. **Account IDs**: same rules as the client (length, allowed characters); reject anything else
   with `invalid_account_id`. Insert `memberinfo` (and whatever else a new account needs) in one
   transaction.
3. **`/v1/coins/add` is idempotent**: keep a table of applied `creditId`s (unique). If a
   `creditId` was already applied, return success with the current balance and do nothing.
   The website may retry the same credit after a timeout.
4. Coins go to the Item Mall balance the client reads. If the player is online, push the new
   balance to the client as well.
5. Rankings and factions exclude GM and test accounts.
6. Unstuck moves the named character of that account to its faction capital; refuse while the
   account is logged in (`error: "online"`).
