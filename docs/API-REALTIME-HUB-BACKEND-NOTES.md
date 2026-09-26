# The Realtime Hub Flap — Cause and Fix

Cause found, fixed, and it is not "expected in development". It is also not the token.

**Restart the API.** No migration. Your client-side work stands and is worth keeping — see §5.

---

## 1. The cause: Redis is not running, and the SignalR backplane is not fail-soft

The hub registers a **Redis backplane**. `RedisHubLifetimeManager` holds each connection's
subscription, so a connection it cannot register is one that would silently miss every message —
and rather than serve that, SignalR refuses the connection. With Redis down, that is every
connection, for as long as the page is open.

Nothing is listening on `localhost:6379` on this machine. I checked again just now: still down. It
has been down since at least the 23rd — it is the same outage behind the `search_expired` error on
business import.

The timings in your own logs are the fingerprint:

```
101  Switching Protocols   ← the socket upgrades fine
     ~3–5s                 ← Redis connect timeout is 2s, ConnectRetry 1
     closed
     reconnect
```

728 successful upgrades across two days, **median lifetime 2.97 seconds**. Not a clean close, not
an auth failure, not a proxy idle timeout — the connection is aborted by the backplane's failed
connect, and the duration is the connect timeout rather than anything protocol-shaped.

The only trace in fourteen hours of logs was three lines:

```
Error  RedisHubLifetimeManager  "Not connected to Redis."
```

Which is why this took a browser network tab to find. Addressed in §3.

## 2. The 102 IDX10517s are your test runner, not the app

This is the one part of your diagnosis I have to correct, and the evidence is unambiguous.

All 103 of them (I count 103 across the two files) carry:

```
origin: http://localhost:9876
```

**Port 9876 is Karma's default.** Every one is the Angular unit-test browser, and every one *also*
failed CORS for the same reason — `9876` is not in `Cors:AllowedOrigins`, which lists the `:4200`
variants. Same 103 request ids, both failures, perfectly paired.

So the tokens failing signature validation are whatever the specs mint, which of course do not
verify. The hub is **not** rejecting a token the API accepts:

- there is exactly one `AddJwtBearer` scheme and one `TokenValidationParameters`;
- `OnMessageReceived` only lifts `access_token` off the query string for `/hubs`, then hands it to
  that same pipeline;
- and 728 real connections from `:4200` authenticated fine before dying of the Redis problem.

`Number of keys in Configuration: '0'` is normal for a symmetric key — it means "no OIDC metadata
document", not "no key". The empty `KeyId` is likewise normal: HS256 tokens carry no `kid`.

Worth knowing separately: your specs are firing real connection attempts at a running API during
`ng test`. Harmless, but it is 103 rejected sockets of noise in the logs, and it will be confusing
again next time.

## 3. What I changed

**A `Redis:UseSignalRBackplane` switch, separate from `Redis:Enabled`.** The two dependencies fail
in opposite ways and one flag for both was wrong: the cache is fail-soft (a read becomes a miss),
the backplane cannot be (see §1). Defaults to **true**, so production is unchanged.

**Off in `appsettings.Development.json`.** Development is one Kestrel process — there is nothing
for a backplane to bridge, and it was taking the entire realtime channel down whenever Redis was
unavailable. The cache stays on, so nothing else changes.

**A line at startup saying which mode the hub is in**, and what that implies:

```
Realtime hub /hubs/realtime is running without a backplane. Pushes reach clients on this
instance only, which is correct for a single instance and wrong for more than one.
```

That line is the actual fix for how long this took to find.

**So: restart the API and the hub stays up, with or without Redis.** Starting Redis is still worth
doing — the cache and business-search import need it:

```bash
docker run -d --name marketing-redis -p 6379:6379 redis:7-alpine
```

**Before scaling to more than one instance, set `UseSignalRBackplane: true` and make sure Redis is
actually reachable from every instance.** Without it, a push reaches only the instance that made
it, and roughly half your users miss every update — silently. That is the trade this switch makes,
and it is the right one for one instance and the wrong one for two.

## 4. Your other four suspects

**Token lifetime on the socket** — not it, and worth ruling out properly: exactly **one**
`SecurityTokenExpiredException` in two days, and it was on `/api/v1/auth/heartbeat`, not the hub.
The hub reads the token once at handshake and does not re-validate mid-connection, so an expiring
token drops the socket only at the *next* reconnect. If you ever do see that loop, the header
`X-Token-Expired: true` is already on the response and the client can refresh before retrying.

**Keep-alive versus a proxy** — not it. `KeepAliveInterval` is 10s and `ClientTimeoutInterval` 30s,
and the sockets were dying at ~3 seconds, before the first keep-alive was due. Nothing sits in
front of Kestrel in development.

**Scaled out without a backplane** — the opposite, and that is the joke of it: one instance *with*
a backplane it could not reach.

**`skipNegotiation` — you can drop it now.** `X-Requested-With` is **already** in the allowed CORS
headers, and has been; the comment in `realtime.service.ts` is out of date. The full list is
`Authorization`, `Content-Type`, `Accept`, `X-Requested-With`, `X-Correlation-Id`, `X-Device-Id`.
Let negotiation run and you get the long-polling fallback back, plus a far more diagnosable failure
mode — which, on this evidence, is worth having.

## 5. Keep all four of your client changes

None of them were working around a bug that has now gone away; each is right on its own terms:

- **Throttling `resynced$` to one refetch per 30s.** Correct reasoning — a missed event is no more
  missed thirty seconds later. Keep it even with a healthy hub; a reconnect after a laptop wakes up
  should not stampede every listener.
- **Giving up after three short connections.** Keep this especially. It is the only thing that
  bounds the damage from a backplane or network problem the client cannot see, and push genuinely
  is an enhancement.
- **0/2/5/15/30 then stop.** Better than the SignalR default for exactly this failure.
- **Background refetch instead of skeletons.** Independently right.

## 6. Answering the question you asked

Not expected, not acceptable, and fixed. The hub should stay connected after a restart. If it does
not, the startup line now tells you which mode it is in, and I would want the next `/hubs/realtime`
entries from `logs/` plus whether that line says "using the Redis backplane" or "without a
backplane".

Tests: 3 new on the option binding — both switches default on, the backplane can be turned off on
its own, and turning the cache off does not silently change the backplane. Full unit suite:
**768 passing**. API builds clean.
