# Embedded Signup — Backend Notes

Everything the browser needs to complete Meta Embedded Signup, and the one behaviour change that
affects a screen you have already built.

The popup flow itself is **done on your side** — `meta-signup.service.ts` loads the SDK, calls
`FB.login` with `config_id`, `response_type: 'code'`, `override_default_response_type: true` and
`sessionInfoVersion: '3'`, and resolves `{ code, wabaId, phoneNumberId }`. Nothing there needs
changing. This document covers what is new around it.

---

## 1. The configuration id is set

`environment.meta.configId` was empty, which is why the connect button was disabled. Both
environment files now carry the real values:

```ts
meta: {
  appId: '934175505679137',
  configId: '1597003388716127',
  graphVersion: 'v21.0',
}
```

Development and production point at the **same Meta app**, by decision. `isConfigured()` now returns
true, so the connect button is live.

**Do not add Meta's `<script>` snippet to `index.html`.** Their setup page offers one; the service
already injects `connect.facebook.net/en_US/sdk.js` and calls `FB.init` itself. Adding theirs
initialises the SDK twice, on two different versions.

### On `graphVersion`

Meta's snippet suggests `v26.0`. Ours stays `v21.0` deliberately: it matches the version the server
uses for its own Graph calls, so the browser and the API cannot end up on two versions of the same
flow. **v21.0 expires 21 January 2027.** The bump is a single deliberate change across three places
— `environment.ts`, `environment.production.ts`, and the server's `WhatsApp:ApiVersion` — not
something to do piecemeal.

---

## 2. New endpoint — `GET /whatsapp/signup-config`

Optional. It returns the same three values from server configuration:

```jsonc
{
  "data": {
    "appId": "934175505679137",
    "configId": "1597003388716127",
    "graphVersion": "v21.0"
  }
}
```

Requires auth and the `whatsapp.connect` permission. Nothing in it is secret — the app id and config
id reach every browser that opens the dialog anyway. The app **secret**, which is the value that
matters, stays server-side, which is why the code exchange happens there.

**You do not have to adopt this.** Reading `environment.meta` is simpler and has no failure mode.
The endpoint earns its place only when you have deploys where rebuilding the bundle to change a Meta
id is painful — at that point one server setting beats one build per environment. Your call; both
are supported.

---

## 3. `WhatsAppConnectionResponse` has a new field — read this one

```ts
readonly tokenExpiresAt: string | null;   // ISO 8601, or null
```

This is the change that actually affects your screens.

### Why it exists

Embedded Signup issues a token with a **finite life**. The system-user token used for manual
connection does not expire; an Embedded Signup one does. Before this, the expiry was stored and
never read, so a lapsed connection kept reporting `status: 'connected'` and the first sign of
trouble was a campaign failing with an opaque `401` — which at that point is indistinguishable from
a revoked permission.

### The two cases

| `tokenExpiresAt` | Meaning |
| --- | --- |
| `null` | The credential has no stated end — a system-user token. **Not** "expired long ago". |
| An ISO date | The instant the credential stops working. |

### What the server already does

When the token has **already lapsed**, `status` comes back as `'error'` rather than `'connected'`.
You need no logic for that case — the existing error state renders it.

When the token expires **later**, `status` stays `'connected'`, because it still sends. Marking it
errored would take a working screen away from a customer who can carry on using it.

### What is left to you

**A warning while there is still time to act.** The date is on the response precisely so you can
show one — something like *"Your WhatsApp connection expires in 6 days. Reconnect to avoid
interruption."* with the reconnect action beside it, on the WhatsApp screen and ideally as a banner
where a campaign is scheduled.

Suggested thresholds, but use your judgement:

- more than 14 days — say nothing
- 14 to 3 days — an amber notice on the WhatsApp page
- under 3 days — persistent, and worth surfacing outside that page
- lapsed — already `status: 'error'`, so nothing new needed

The point is that the customer finds out while reconnecting is a two-minute job, not when a campaign
fails.

---

## 4. Nothing else about the connect flow changed

`POST /whatsapp/connect` still takes exactly what `launch()` already resolves:

```jsonc
{ "code": "...", "wabaId": "...", "phoneNumberId": "..." }
```

The server exchanges the code (the app secret never leaves it), subscribes the WABA to webhooks,
registers the number, then reads the profile back. `status: 'pending'` first is normal — the polling
you already have is the right response.

The code is **single use**. A retried request fails at Meta, so a retry has to start the popup
again rather than resend the same body.

---

## 5. What still blocks a real customer

Not a frontend concern, but it explains what you will see while testing.

Meta business verification is **pending** and app review is **in review**. Until both clear,
Embedded Signup completes only for accounts listed under the app's roles. If the popup opens and
completes for the developer account but not for anyone else, that is why — not a bug in the flow.

Separately, if the popup opens and closes instantly with nothing logged, the cause is almost always
the origin missing from *Allowed Domains for the JavaScript SDK* in the Meta app. It fails silently
by design.

---

## 6. Summary

| Item | Who |
| --- | --- |
| `configId` filled in both environments | Done — backend |
| `GET /whatsapp/signup-config` | Done — backend, optional to adopt |
| `status: 'error'` on a lapsed token | Done — backend |
| `tokenExpiresAt` on the connection response | Done — backend |
| **Expiry warning UI** | **Yours** |
| Popup, connect call, polling | Already done — yours, unchanged |
