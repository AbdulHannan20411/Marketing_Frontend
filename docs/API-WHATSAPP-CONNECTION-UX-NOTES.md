# WhatsApp Connection Screen — Notes from Live Testing

Written after connecting a real Meta test number end to end and sending a real message. No contract
changes here — these are behaviours the screen should reflect, and one change worth making.

Base path: `/api/v1/whatsapp`.

---

## 1. Disconnect needs a confirmation dialog

**This is the one thing to change.**

`POST /whatsapp/disconnect` destroys the stored credential. One click, no undo, no confirmation.
During testing it was hit by accident, and recovering meant finding the access token again and
re-running the connect — with a token that, for a Meta test number, expires every 24 hours and may
no longer exist by the time somebody notices.

For a customer on a real number the recovery is worse: the token came from Embedded Signup, so
"just paste it again" is not available to them at all. They have to redo the signup flow.

Suggested treatment, matching the workspace-deactivation dialog already built:

- Confirm before sending, stating plainly that campaigns stop sending until it is reconnected
- Say that reconnecting needs Embedded Signup again — that is the part people do not expect
- Style it as a destructive action rather than a neutral one

### What Disconnect actually does, for the copy

It is **local only**. Nothing at Meta is touched:

```
status                → disconnected
encryptedAccessToken  → destroyed
tokenExpiresAt        → cleared
```

The number stays claimed at Meta and the app stays subscribed to the WhatsApp Business Account —
verified during testing, both survived a disconnect. So the copy should say the workspace stops
sending, **not** that the number is removed from Meta or that anything is deleted there.

---

## 2. `webhookHealthy: false` is not an error

It flips to `true` only when a webhook actually arrives from Meta. On a fresh connection, and on any
local or private deployment Meta cannot reach, it is legitimately `false` while everything else
works perfectly.

Sending is unaffected — a message was sent successfully with this reading `false`.

**Do not render it as a failure or a warning on its own.** It means "we have not heard from Meta
yet", which is a different statement from "something is broken". If it is shown at all, wording like
*"Waiting for the first update from Meta"* is honest; a red indicator is not.

---

## 3. Token expiry surfaces as a 401, and should read as a prompt

When the stored token lapses, every WhatsApp call fails:

```
Graph API returned 401. Code 190
```

The client currently shows this as a generic external-service error. It is worth special-casing,
because the user can fix it themselves and the generic message does not tell them how.

Two audiences, one condition:

- **Test numbers** expire every 24 hours. The fix is to regenerate the token in the Meta dashboard
  and reconnect.
- **Production numbers** using a System User token do not expire, so a 401 there means the token was
  revoked or permissions changed — support territory.

Something like *"The WhatsApp connection needs to be re-authorised"* with a link to the connection
screen serves both better than a raw provider error.

### Backend gap worth knowing about

`tokenExpiresAt` is stored but **nothing currently reads it**, so there is no warning before a token
lapses — the first sign is a failed send. That is a backend fix, not a frontend one, and it is on my
list.

---

## 4. `messagingLimit: 0` means "not yet rated", not "zero allowed"

Meta reports no limit for a number it has not rated, which is every new connection and every test
number. Zero here means unknown.

Rendering it literally would tell a customer they may send nothing, which is the opposite of the
truth. Either hide the figure while it is `0`, or show the tier instead — `messagingTier` is
populated (`tier_250` on a fresh connection) and is the more meaningful number.

---

## 5. Verified live

Against a real Meta test number, not a mock:

- Connect stored the credential, subscribed webhooks, read the phone profile and the WABA namespace
- A template message reached a real handset — Meta returned `message_status: accepted`
- Disconnect cleared the local credential and left Meta's side untouched
- Reconnect restored the connection with the same WABA and phone number ids, no Meta changes needed

Connection state as it reads today:

```jsonc
{
  "status": "connected",
  "displayPhoneNumber": "+1 555-657-1705",
  "verifiedName": "Test Number",
  "qualityRating": "green",
  "messagingTier": "tier_250",
  "messagingLimit": 0,        // not yet rated — see §4
  "webhookHealthy": false     // no webhook yet — see §2
}
```

---

## 6. Summary

| # | Change | Priority |
| --- | --- | --- |
| 1 | Confirmation dialog on Disconnect | **Do this one** |
| 2 | Stop treating `webhookHealthy: false` as an error | Worth doing |
| 3 | Friendly copy for a 401 / expired token | Worth doing |
| 4 | Hide or reinterpret `messagingLimit: 0` | Minor |
