# Game API — the private link between the website and the game server

The website never connects to `ts2_gamedb` directly. The game server (Blacklist2.Server, C#)
exposes a small HTTPS API that only the website may call. This file is the contract both
sides follow. Until the game side exists, run the website with `GAME_API_MODE=mock`.

## Transport and security

- HTTPS only. Expose it through a tunnel (for example Cloudflare Tunnel) at a host such as
  `game-api.blacklist2.com`; do **not** open the MySQL port or this API's port on the router.
- Every request carries:
  - `x-b2-timestamp`: Unix seconds.
  - `x-b2-signature`: hex HMAC-SHA256 of `"{timestamp}.{METHOD}.{path?query}.{rawBody}"`
    with the shared secret `GAME_API_SECRET` (raw body is `""` for GET).
- The server rejects a request when the signature does not match (constant-time compare) or the
  timestamp is more than 60 s away from its clock.
- Optionally also allow-list the website's outgoing IP.
- Responses are JSON. Success: `{ "ok": true, ... }`. Failure: HTTP 4xx/5xx with
  `{ "ok": false, "error": "<code>", "message": "<text a player may see>" }`.

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
