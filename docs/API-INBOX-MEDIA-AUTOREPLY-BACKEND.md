# Inbox, Media, Auto-Reply — Backend Notes

For the frontend agent. Covers everything built against *WhatsApp: Signup, Templates, Media & Inbox —
API Requirements*, plus the location-search fix and a new feature that needs UI: **AI auto-reply**.

Every route is under `/api/v1/`. Every response is the usual envelope:

```jsonc
{ "data": …, "message": "…", "traceId": "…" }
```

Paged endpoints wrap `data` as `{ items, page, pageSize, totalItems, totalPages }`.

Enums serialise camelCase — `inbound`, `queued`, `document`. Trigger keys in the auto-reply maps are
literal snake_case strings (`first_message`), not enums.

---

## 1. Inbox — built as specified

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/whatsapp/conversations?page&pageSize&search` | Newest activity first; `search` matches name or number |
| `GET` | `/whatsapp/conversations/{id}` | One thread |
| `GET` | `/whatsapp/conversations/{id}/messages?page&pageSize` | Oldest first; default page size 50 |
| `POST` | `/whatsapp/conversations/{id}/messages` | Free-form reply |
| `POST` | `/whatsapp/conversations/{id}/read` | Clears `unreadCount`, idempotent |

Shapes match §5 of your note field for field. Two things worth knowing:

- **`windowExpiresAt` is returned only while the window is open.** Once it lapses the field is `null`
  rather than a past date, so the countdown can never run on a stale value.
- **`contactId` is null** when the number is not a saved contact. The webhook matches contacts by
  normalised number and never creates one.

### Errors on send

| Status | `errorCode` | When |
| --- | --- | --- |
| `409` | `window_closed` | More than 24 hours since the customer's last message |
| `409` | `not_connected` | No WhatsApp account linked |
| `409` | `media_not_uploaded` | The attachment never reached Meta; upload it again |
| `422` | `validation_failed` | Empty text, missing `mediaId`, or `kind: template` |
| `404` | — | The conversation belongs to another workspace |

A reply is written as `queued` **before** Meta is called, then moved to `sent`, or to `failed` with a
plain-language `failureReason` (Meta's numeric codes are translated — 131026 becomes "Message
undeliverable. The number may not use WhatsApp…"). A failed reply stays in the thread.

---

## 2. Media — built as specified

`POST /whatsapp/media` — multipart, `file` + `kind` (`image` | `video` | `document` | `audio`).
`GET /whatsapp/media/{id}` — raw bytes, bearer required, tenant-scoped (404 for another workspace).

Response is exactly the shape in §4. Limits are enforced server-side too: 5 MB images (JPEG, PNG),
16 MB video (MP4, 3GP), 100 MB documents (PDF, Word, Excel), 16 MB audio (AAC, MP3, M4A, OGG). A
browser's `audio/ogg; codecs=opus` is accepted — parameters are ignored.

Bytes are stored by this platform, not fetched from Meta, so a six-week-old thread still renders.
`url` on the response is always our own `/api/v1/whatsapp/media/{id}`.

---

## 3. Webhook — the inbox now fills itself

Implemented: signature check, the GET handshake, inbound messages, delivery receipts, template
verdicts, **template re-categorisation**, and quality/tier updates.

- **The window is reset from the customer's own timestamp**, not from when we processed it.
- **Redelivery is a no-op** — Meta's message id is unique, checked twice.
- **Attachments are downloaded** into our storage as they arrive.
- **Types we can't render** (location, sticker, contacts, unknown) arrive as `kind: "system"` with a
  readable body — "Shared a location". Render them as a muted line rather than an empty bubble.
- **A tapped template button** arrives as `kind: "text"` whose body is the button label.
- **Delivery receipts now move an agent's reply too**, never backwards, so ticks work in the thread.

### Realtime (§10)

Event name **`inboundMessage`** on the existing `/hubs/realtime`, tenant group:

```jsonc
{
  "conversationId": "cnv_12",
  "contactName": "Amara Okafor",
  "phoneNumber": "+92 300 1234567",
  "preview": "Could you send the receipt?",
  "unreadCount": 3,
  "windowExpiresAt": "2026-09-19T09:06:00Z",
  "occurredAt": "2026-09-18T09:06:00Z"
}
```

Enough to update a thread in place, bump the unread badge and restart the countdown without refetching.

---

## 4. Templates — two changes

- **`headerKind` is now returned** on every template response (§13): `none` | `text` | `image` |
  `video` | `document`. The campaign builder no longer has to guess whether a template needs a file.
  **Templates synced from Meta report `none`** — Meta's list call doesn't return components, so only
  templates created through this platform know their header kind.
- **Only a rejected template may be edited.** `PUT /templates/{id}` on anything else returns
  **409 `template_not_editable`**, naming the current status.

Unchanged from the earlier handoff: creating a template submits it to Meta in one step; Meta's own
refusal text comes back as **409 `template_rejected_by_meta`**; media headers are refused with
**422** because they need a sample file uploaded with the template, which isn't built yet.

---

## 5. Location search — fixed, no client change

Both `/business-discovery/places` and `/places/reverse` now use **Places API (new)** instead of the
legacy Geocoding API, which was refused for want of billing on the Google project. The contract is
unchanged: `{ id, label, latitude, longitude, country, countryCode }`, `label` is the full formatted
address, `countryCode` is ISO 3166-1 alpha-2.

What changed for you: **a misconfigured provider is now an error, not an empty list.**

| Status | `errorCode` | Meaning |
| --- | --- | --- |
| `409` | `provider_not_configured` | No key, or Google refused it — show "not available" |
| `402` | `provider_quota_exceeded` | Our quota, not the user's |
| `502` / `503` | `external_service_*` | Transient; a retry is reasonable |

An empty list now genuinely means "no such place".

---

## 6. AI auto-reply — new, needs UI

The assistant answers customers by itself, on occasions the admin chooses and the **plan** unlocks.

### `GET /whatsapp/auto-reply`

```jsonc
{
  "enabled": true,
  "triggers":        { "greeting": true,  "first_message": false, "unanswered": false },
  "allowedTriggers": { "greeting": true,  "first_message": true,  "unanswered": false },
  "delaySeconds": 60,
  "unansweredAfterMinutes": 300,
  "instructions": "We are a salon in Lahore. Never quote prices.",
  "maxPerConversationPerDay": 3,
  "monthlyLimit": 500,
  "usedThisPeriod": 137,
  "remainingThisPeriod": 363,
  "periodEndsAt": "2026-10-01T00:00:00Z",
  "assistantConfigured": true
}
```

- **`triggers`** is what the admin chose. **`allowedTriggers`** is what the plan sells. Render a
  trigger the plan doesn't sell as **disabled with an upgrade hint**, not hidden — an admin should see
  what an upgrade buys.
- **`assistantConfigured: false`** means this deployment has no AI key. Everything else on the screen
  is inert; say so rather than letting someone switch on something that cannot run.
- **`monthlyLimit: null`** means no ceiling; `remainingThisPeriod` is then null too.

### `PUT /whatsapp/auto-reply`

Send the same fields you'd edit: `enabled`, `triggers`, `delaySeconds`, `unansweredAfterMinutes`,
`instructions`, `maxPerConversationPerDay`.

| Status | `errorCode` | When |
| --- | --- | --- |
| `409` | `auto_reply_trigger_not_in_plan` | A trigger the plan doesn't sell; the message names it |
| `422` | `validation_failed` | Field-keyed: `delaySeconds`, `unansweredAfterMinutes`, `maxPerConversationPerDay`, `instructions` |
| `403` | — | Plan lacks the `ai` module entirely (route is module-gated) |

Ranges: **delay 10 s – 30 min**, **unanswered wait 5 min – 24 h**, **1–20 replies per customer per
day**, instructions ≤ 2000 characters. Permission: `settings.integrations`.

### What the triggers mean

| Key | Fires when | Uses |
| --- | --- | --- |
| `greeting` | The message is *only* a greeting — hi, hello, salam, aoa, "assalam o alaikum", Urdu script, emoji | `delaySeconds` |
| `first_message` | First message of a new conversation, whatever it says | `delaySeconds` |
| `unanswered` | Nobody replied at all | `unansweredAfterMinutes` |

"hi, where is my order" is **not** a greeting — it waits for a person. Worth saying in the UI copy,
because admins will ask.

### In the thread

Auto-replies are normal outbound messages **plus `isAutoReply: true`** on the message. Label them
("Sent automatically") so an agent reading back knows what the customer was told.

Behaviour worth reflecting in copy:

- Only inside the **24-hour window**. Outside it nothing is sent.
- **An agent replying first cancels it** — checked at the moment of sending.
- **A customer writing again resets the timer.**
- When the allowance runs out, replies pause and every admin gets an **`aiRepliesExhausted`**
  notification. New `NotificationKind` — add an icon and route for it (`/subscription`).

### Super Admin plan editor

Plans now carry two more things:

```jsonc
{
  "autoReplyTriggers": { "greeting": true, "first_message": true, "unanswered": false },
  "limits": { "monthlyAiReplyLimit": 500 }
}
```

Both accepted on plan create and patch. `monthlyAiReplyLimit: null` = no ceiling. Same map convention
as `modules`.

---

## 7. Not built

- **Campaign template sends don't appear in the inbox thread.** They live in campaign tables; a
  template you sent won't show in the conversation.
- **No in-browser voice recording**, no conversation assignment, no business-hours rule for
  auto-reply ("only after 6 pm") — all straightforward to add if wanted.
- **Media headers on templates** still refused (needs Meta's sample-file upload).

## 8. Needed before any of this works live

1. **A public webhook URL.** Meta cannot reach `localhost`; without a tunnel the inbox stays empty and
   auto-reply never fires. Nothing arrives until the callback URL and verify token are set in the Meta
   app dashboard, with the **messages** field subscribed.
2. **A Gemini key** for auto-reply, and the **`ai` module plus triggers and a limit** on at least one
   plan, or `allowedTriggers` comes back all false.
