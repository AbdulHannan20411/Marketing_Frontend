# WhatsApp Embedded Signup — Backend Requirements

Per-tenant onboarding. Every admin connects **their own** WhatsApp Business Account through Meta's
Embedded Signup popup; the platform holds one credential per tenant and never asks anyone to paste a
token.

The front end is built and verified against the contract below, with the whole flow mocked so it can
be exercised offline. Two endpoints are new; one existing endpoint gains a field.

---

## 1. Why this is not a single call

The popup is the fast half. Everything that can actually fail happens **after** it closes, on the
server, across five Graph calls that take anywhere from a few seconds to about a minute.

Today `POST /whatsapp/connect` is modelled as one synchronous call that either works or doesn't. That
cannot distinguish "the number is already registered elsewhere" from "the webhook subscription
failed" — and those have completely different remedies, **one of which the admin has to carry out
inside Meta's own console**. An admin who gets "Could not connect" has nowhere to go and opens a
support ticket.

So: `connect` accepts the code and returns immediately with `status: "pending"`. The client polls
`GET /whatsapp/connection` every 2s (giving up at 3 minutes) and renders the step-by-step progress.

---

## 2. `POST /api/v1/whatsapp/connect`

Unchanged request — this is what Meta's popup returns:

```jsonc
{
  "code": "AQD…",              // single-use, short-lived
  "wabaId": "1375136894752893",
  "phoneNumberId": "1306084662583795"
}
```

**Changed response.** Return `202`-style immediately rather than blocking:

```jsonc
{
  "status": "pending",
  "displayPhoneNumber": "",
  "verifiedName": "",
  "onboarding": {
    "step": "exchange",
    "completed": [],
    "failure": null,
    "startedAt": "2026-09-03T09:12:04Z",
    "updatedAt": "2026-09-03T09:12:04Z"
  }
  // …the rest of WhatsAppConnection, zeroed
}
```

Kick the five steps off on a background worker and return. **Do not block the request** — the client
has already stopped waiting on it.

`code` is single-use and short-lived. Exchange it and **discard it**; do not log it, and do not
persist it alongside the resulting token. The client never stores it either.

### Validation

| Condition | Response |
| --- | --- |
| `code` missing/blank | `422`, `{ "Code": ["The authorisation code is required."] }` |
| `wabaId` missing/blank | `422`, `{ "WabaId": ["A WhatsApp Business Account id is required."] }` |
| Code already expired at exchange | `400`, problem `type`/code `code_expired` |

Field-error keys stay **PascalCase**, matching the rest of the API; the client already matches
case-insensitively.

---

## 3. The five steps

Run in this order. `completed` accumulates; `step` is the one in progress, or the one that stopped.

| `step` | What it does | Why it is separate |
| --- | --- | --- |
| `exchange` | Swap `code` → long-lived business token | Fails on expiry/replay |
| `account` | Read the WABA, confirm it was shared with the app | Fails when permissions were declined, or verification is incomplete |
| `phone` | Register `phoneNumberId` on the Cloud API | The slow one, and the one with the most distinct failures |
| `webhook` | Subscribe the app to that WABA's webhooks | **Silent killer** — skipping it means sends work and no status ever returns |
| `profile` | Read display name, quality rating, messaging tier | Cosmetic; a failure here should not undo a live connection |

`webhook` earns its own step precisely because its failure is invisible: everything looks connected
and delivery reports never arrive.

---

## 4. `GET /api/v1/whatsapp/connection`

Already exists and already returns `status`. Add **one optional field**:

```jsonc
{
  "status": "pending",          // pending | connected | error | disconnected
  "onboarding": {
    "step": "phone",
    "completed": ["exchange", "account"],
    "failure": null,
    "startedAt": "2026-09-03T09:12:04Z",
    "updatedAt": "2026-09-03T09:12:31Z"
  }
}
```

- `onboarding` is `null` (or absent) once terminal, **except** on failure, where it must persist so
  the admin can still read what happened after a reload.
- On success: `status: "connected"`, `onboarding: null`, and the real profile fields populated.
- On failure: `status: "error"` and `onboarding.failure` set.

The client treats `onboarding` as optional, so shipping the two endpoints before this field is safe —
the screen just falls back to a plain spinner.

### Failure shape

```jsonc
"failure": {
  "step": "phone",
  "code": "phone_already_registered",
  "detail": "That number is already registered to a different WhatsApp Business Account."
}
```

`detail` is yours and is rendered verbatim — it knows what Meta actually said. `code` picks the
remedy, which lives client-side so its wording can change without a backend deploy.

### The codes

Closed set. Anything unrecognised falls back to `unknown`.

| `code` | Step | Retry offered? |
| --- | --- | --- |
| `code_expired` | exchange | yes |
| `token_exchange_failed` | exchange | yes |
| `waba_not_shared` | account | yes |
| `business_not_verified` | account | **no** |
| `phone_already_registered` | phone | **no** |
| `phone_pin_required` | phone | **no** |
| `phone_registration_failed` | phone | yes |
| `webhook_subscribe_failed` | webhook | yes |
| `profile_unavailable` | profile | yes |
| `unknown` | any | yes |

The three "no" rows need a change inside Meta first. The client **hides the Try again button** for
them rather than walking the admin back into the same wall — so mapping a Meta error onto the right
code is what makes that work.

---

## 5. `POST /api/v1/whatsapp/disconnect`

Referenced by the client and **not currently implemented** — it 404s. Destroy the stored credential,
unsubscribe the webhook, return the connection with `status: "disconnected"` and `onboarding: null`.

---

## 6. Multi-tenancy

- `TenantId` comes from JWT claims. The client sends nothing identifying a workspace on either
  endpoint.
- One credential per tenant, encrypted at rest. A tenant's token must never be reachable from
  another tenant's request path.
- `wabaId` uniqueness: if a WABA is already connected to a **different** tenant, fail `account` with
  `waba_not_shared` (or a dedicated code, if you would rather — tell me and I will add it) rather
  than silently rebinding it.
- The Super Admin `?adminId=` scope applies to `/whatsapp/connect/manual` only. Embedded Signup is
  always the caller's own tenant — an admin connects their own account, never someone else's.

---

## 7. Webhooks

One app-level webhook receives every tenant's events, so the handler has to route by `waba_id` in
the payload to the owning tenant. Persist `wabaId → tenantId` at the `account` step, before the
`webhook` step runs, or the first inbound event has nowhere to go.

---

## 8. Config I still need

Blocking, and only obtainable from your Meta app:

| Value | Where | Status |
| --- | --- | --- |
| **App ID** | App Dashboard → Settings → Basic | ✅ `934175505679137` |
| **Config ID** | WhatsApp → Configuration → *Login with Facebook* → configuration id | ✅ `1597003388716127` |
| **App Secret** | Settings → Basic | Backend only — `dotnet user-secrets`, never `appsettings*.json` |

**Resolved** — both environment files now carry the config id and the Connect button is live. The
client never sees the app secret; the code exchange is server-side precisely because that secret
cannot go in a browser bundle. See §12 for what was and was not adopted alongside it.

Also add your dev origin to **App Domains** and to Valid OAuth Redirect URIs, or the popup refuses to
open.

---

## 9. What is built and verified

- **Pre-flight checklist** before the button — verified business, a number not already on WhatsApp,
  two-step verification off. All three are things signup cannot fix on the admin's behalf, and
  finding out at step four means starting over.
- **Live progress panel**, `aria-live`, one row per step, detail line on the active step.
- **Failure panel** — the step, your sentence, the remedy, and Retry only where retrying helps.
- **Resume on reload.** Onboarding runs on the server, so reopening the page mid-flow picks the poll
  back up instead of showing a frozen panel.
- **Popup cancel/error handling.** Meta posts `current_step` on both; the client now reads it, so a
  cancellation says *"Signup was closed at verifying the phone number"* instead of nothing at all.
- **Mocked end to end** — `POST /connect`, staged `GET /connection`, `POST /disconnect`, plus four
  failure scenarios triggered by a `phoneNumberId` suffix (`-fail-verify`, `-fail-phone`,
  `-fail-pin`, `-fail-webhook`).

Browser-verified against the mock: all five steps advance and settle into the connected card;
`phone_already_registered` shows the remedy with **no** Retry; `webhook_subscribe_failed` shows
Retry. Production build clean.

---

## 10. Two questions

1. **Is `phoneNumberId` optional on connect?** A WABA can carry several numbers and Meta does not
   always return one from the popup. If it can be absent, I need a number-picker step and a
   `phoneNumbers[]` on the connection — tell me and I will build it.
2. **Idempotency.** If the same `code` is replayed, is the second call a `409`, or does it join the
   in-flight onboarding? The client will not do this deliberately, but a double-click or a retried
   request can.

---

## 11. Expiry warning — built

Your §3 is done. `tokenExpiresAt` is on the model and drives a shared notice on **three** screens.

**`null` is treated as "no stated end", never as expired.** That was the trap worth naming: a
system-user token has no expiry, and reading an absent date as a lapsed one would have put a
permanent red banner on the one connection that can never lapse. Explicitly tested.

Your thresholds, as specified:

| Remaining | Behaviour |
| --- | --- |
| > 14 days | silent |
| 14 – 3 days | amber notice |
| < 3 days | red, and shown outside the WhatsApp page |
| lapsed | nothing new — `status: 'error'` already renders |

One shared component rather than three hand-written banners, so the threshold and the wording cannot
drift apart. It also stays silent whenever `status !== 'connected'`: a broken connection has its own,
louder treatment, and two warnings about one problem read as two problems.

Where it appears:

- **WhatsApp page** — above the hero card, with **no** Reconnect link: a link to the page you are
  already on is a dead end where the action should be.
- **Dashboard** — with the link. An admin who never opens the WhatsApp screen would otherwise learn
  about the expiry from a failed campaign.
- **Campaign form** — the last point it can be said before a scheduled send is what discovers the
  credential has lapsed. This screen now loads the connection alongside templates and groups.

Verified: 13/13 on the threshold function, including `null`, `undefined`, `''` and an unparseable
date, all of which return "say nothing" rather than rendering `NaN`. In the browser at 6 days —
amber, *"expires in 5 days"*, `role="status"`, Reconnect present on the dashboard and absent on the
WhatsApp page; at 2 days — red, *"expires tomorrow"*, on all three screens.

## 12. Noted, not acted on

- **`graphVersion` stays `v21.0`** and I have not touched it. Agreed it should move with the
  server's `WhatsApp:ApiVersion` as one deliberate change; **21 January 2027** is the deadline.
- **`GET /whatsapp/signup-config` — not adopted.** `environment.meta` has no failure mode and no
  request to wait on. Worth revisiting the first time changing a Meta id means a rebuild per
  environment; the endpoint is there when that day comes.
- **No SDK snippet in `index.html`** — confirmed absent, so there is no second `FB.init`.
- **Both environment files carry `configId: '1597003388716127'`** — confirmed, and the connect
  button is live.
- **App review pending** — understood that signup will only complete for accounts on the app's
  roles until it clears, and that a popup which opens and shuts instantly means the origin is
  missing from *Allowed Domains for the JavaScript SDK*. Neither is a client bug; I will not chase
  them as one.


---

## 13. Realigned to the shipped contract

Sections 1–4 above describe the shape I *proposed*; the shape you shipped is different and better in
two places. The client now implements yours. Treat §13 as authoritative where it disagrees with §1–§4.

**What I changed:**

| Mine | Yours | Note |
| --- | --- | --- |
| 5 steps, `exchange`/`account`/`phone`/`webhook`/`profile` | 4 steps, `token`/`subscribe`/`register`/`profile` | `subscribe` before `register` |
| `onboarding` optional, null when terminal | never null, idle set when unattempted | one shape, no branch |
| Poll while `status === 'pending'` | poll while `onboarding.running` | **your call is right** |
| `failure` object on the onboarding | `status: 'failed'` on a step, with `code`/`message` | later steps stay `pending` |
| Closed code set | open set with a fallback | see below |
| Retry hidden for some codes | always offered | every remedy of yours ends in reconnecting |

**Poll on `running` — agreed and implemented.** I had it deriving from `status`, which is the same
mistake in a different place: two sources for "am I finished". It reads `onboarding.running` now and
nothing else.

**`skipped` renders neutrally.** A muted tick and the words *"Already registered"* — no amber, no
warning icon, nothing that reads as a problem. Verified: the happy path with `register` skipped shows
four steps and settles to connected with no warning anywhere on screen.

**Unknown codes fall back.** Every lookup goes through `onboardingRemedy(code)`, never a direct
index, so a code this build has never seen still produces the generic remedy rather than an empty
panel. Verified with a deliberately fictional `some_future_code`: heading, generic remedy, details
toggle and Try again all render.

**`message` is behind a "Show details" toggle**, collapsed by default, monospace, with
`aria-expanded`. It is never primary copy — agreed that Meta's untranslated wording is for a support
ticket, not for the first thing an admin reads. The primary line is ours: *"The connection was not
completed. Nothing that already succeeded has been undone."*

**Retry reopens the popup.** It cannot resend the request — the code is single use, as you said
earlier. Safe given your guarantee that a succeeded step is never re-run, so a failure at `subscribe`
does not re-register the number.

Mocked end to end with six scenarios: `-fail-token`, `-fail-subscribe`, `-fail-register`,
`-fail-profile`, `-fail-unknown` and `-skip-register`, chosen by `phoneNumberId` suffix.

### One question

**Is there a resume that does not need a new code?** For `subscribe_refused` the credential is
already stored and valid — only one Graph call failed. Making the admin walk the entire Meta popup
again to retry that call is a lot of ceremony for a step that could resume from where it stopped.

If `POST /whatsapp/connect/resume` (or re-issuing connect with no code) could kick the scheduler at
the first unfinished step, I would use it for every failure except `token_rejected`, where a new
credential genuinely is the fix. Your note says a stalled connection is already picked up again —
this is asking for the same thing on a *failed* one, on demand.

### Correction accepted

Noted that `Pending` was written and overwritten before the response was built, so the polling path
was genuinely unreachable rather than merely undocumented. Nothing to argue about — it is fixed.
