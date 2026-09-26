# The Realtime Hub Is Not Staying Connected

Watching the network tab on the campaigns screen, three requests repeat **every three to five
seconds**, indefinitely:

1. a realtime connection attempt to `/hubs/realtime`,
2. `GET /api/v1/notifications`,
3. `GET /api/v1/campaigns` (plus its summary).

Nothing in the client polls. Those last two are the client's response to the hub reconnecting: the
hub does not replay missed events, so every listener refetches when the connection comes back. A
connection that comes back every few seconds therefore produces a full refetch every few seconds —
and the screens visibly reloaded while people were reading them.

---

## 1. Fixed on the client, regardless of the cause

- **One refetch per 30 seconds, whatever the hub does.** `resynced$` is throttled on the leading
  edge, so the first reconnect refetches immediately and a storm behind it is dropped. Missing an
  event ten seconds ago is still missing it thirty seconds later; the refetch does not need to
  happen five times.
- **The client gives up on a flapping hub.** Three connections in a row that last under twenty
  seconds and push is abandoned for the rest of the session. Push is an enhancement — the app is
  correct without it — and a handshake plus a full refetch every few seconds costs far more than
  the updates are worth.
- **Reconnect backoff** is now 0s, 2s, 5s, 15s, 30s and then stop, rather than the SignalR default.
- **Refetches no longer clear the screen.** A background reload keeps the rows in place instead of
  swapping them for skeletons and back, which is what "the page is blinking" was.

So the traffic stops either way. What remains is why the connection does not stay up.

## 2. The cause, found in your logs

Since writing the above I read `logs/marketing-20260926.json`. It is suspect 2 on the list below:

```
Microsoft.IdentityModel.Tokens.SecurityTokenSignatureKeyNotFoundException: IDX10517:
Signature validation failed. The token's kid is missing.
Keys tried: 'Microsoft.IdentityModel.Tokens.SymmetricSecurityKey, KeyId: ''...
Number of keys in TokenValidationParameters: '1'.
Number of keys in Configuration: '0'.
   RequestPath: /hubs/realtime
```

**102 of them across two days — 62 on the 25th, 40 on the 26th**, the last at 07:24. Every one on
`/hubs/realtime`, and none on any HTTP route: the same token authenticates
`GET /api/v1/contacts` perfectly well in the requests either side of them.

So the hub rejects a token the API accepts. That is not a client problem — the client sends the
same string to both — and it explains the whole pattern: the socket is refused, the connection
closes, the client reconnects, the refetch storm follows.

Worth looking at, in this order:

1. **The hub's own `TokenValidationParameters`.** "Number of keys in Configuration: 0" and a
   `SymmetricSecurityKey` with an empty `KeyId` suggest the `/hubs` path is validating against a
   different (or half-configured) set of parameters from the one the API's `JwtBearer` handler uses
   — a second `AddJwtBearer` scheme, or an `OnMessageReceived` that hands the query-string token to
   a pipeline configured elsewhere.
2. **Whether the token is reaching the handler intact.** `access_token` from a query string is URL
   decoded once; a token that arrives truncated or re-encoded would fail signature validation with
   exactly this error.

The client-side work below stands either way — it stops the storm — but the connection will not
stay up until this is fixed.

## 3. What to check on your side (written before the above)

The client connects **straight over WebSockets with `skipNegotiation: true`**, with the token on
the query string, because the SignalR client sends `X-Requested-With` on negotiate and the CORS
policy allows only `Authorization`, `Content-Type`, `Accept` and `X-Correlation-Id`. That workaround
is in `realtime.service.ts` with a note to remove it once the header is allowed.

Worth looking at, roughly in order:

1. **Hub logs for why connections end.** A clean close, an auth failure and a transport error are
   three different problems; the client cannot tell them apart from the outside.
2. **Token lifetime on the socket.** The token is read once, at handshake. If the hub rejects an
   expired token mid-connection the socket drops and reconnects with the *same* expired token —
   which would loop exactly like this. If that is what is happening, say so and the client will
   refresh before reconnecting.
3. **Keep-alive versus any proxy or dev-server idle timeout** in front of Kestrel.
4. **Whether the hub is scaled out without a backplane**, where a connection can land on an
   instance that does not know it.
5. **`skipNegotiation` itself** — if adding `X-Requested-With` to the allowed CORS headers is easy,
   doing that lets negotiation run normally and restores the long-polling fallback, which would also
   make the failure mode far more diagnosable.

## 4. What I need from you

Either a cause and a fix, or "the hub is expected to drop like that in development" — in which case
nothing more is needed, because the client now handles it quietly. What is not acceptable is the
state before this change: a hundred requests a minute, forever, on an idle screen.
