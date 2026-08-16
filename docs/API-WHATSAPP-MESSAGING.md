# WhatsApp: Signup, Templates, Media & Inbox — API Requirements

Hand this to the backend. The Angular front end is **already built against this contract** and runs
today against an in-memory mock of it. Match the shapes below and the UI needs no changes.

Base path: `/api/v1/`.

> **What already exists** and is unchanged: `POST /whatsapp/connect`, `GET /whatsapp/connection`,
> `POST /whatsapp/connection/sync`, `POST /whatsapp/disconnect`, `GET /templates`,
> `POST /templates/sync`, `DELETE /templates/{id}`, and the campaign endpoints.
>
> **What is new** and needs building:
>
> | | Endpoint |
> | --- | --- |
> | Template authoring | `POST /templates`, `PUT /templates/{id}` |
> | Media | `POST /whatsapp/media`, `GET /whatsapp/media/{id}` |
> | Inbox | `GET /whatsapp/conversations`, `GET /whatsapp/conversations/{id}`, `GET|POST /whatsapp/conversations/{id}/messages`, `POST /whatsapp/conversations/{id}/read` |
> | Connection | one added field — `messagingTier` |
>
> **And the largest piece, which is not an endpoint at all:** the webhook at `/whatsapp/webhook`
> currently exists as a route but does not process anything. Every inbound message, every delivery
> receipt and every template verdict arrives there. Until it is implemented the inbox is
> permanently empty and templates say "pending" forever. See §7.

**How to read this.** §1–5 are the contract the front end already calls — match those shapes exactly
and no UI changes are needed. §6–9 are the mechanics behind them: what to do with Meta, not with us.
§14 suggests an order of work.

---

## 1. Embedded Signup — what the client sends

The popup runs entirely in the browser using the Facebook JS SDK. The client collects two things
and posts them together to the **existing** `POST /whatsapp/connect`:

```jsonc
{ "code": "AQD…", "wabaId": "1234567890", "phoneNumberId": "0987654321" }
```

- `code` is a **single-use authorisation code**, not a token. The client never stores it — not in
  memory beyond the call, not in storage, not on the URL. Exchange it server-side for a business
  token using the app secret, which must never reach the browser.
- The app id and config id live in `environment.ts` as public values. **They are currently empty** —
  fill them in before signup can run; the button is disabled and explains itself until you do.

Nothing else about this endpoint changes.

---

## 2. `GET /whatsapp/connection` — one new field

Add `messagingTier` to the existing response:

```jsonc
{ "messagingTier": "tier_1k" }
```

Values: `tier_250` · `tier_1k` · `tier_10k` · `tier_100k` · `unlimited`.

This is Meta's **daily unique-customer ceiling**, distinct from `messagingLimit`, which the UI
already shows as a rolling 24-hour count. It is read from Meta and reported; it cannot be requested,
so the UI presents it as a fact rather than a setting.

The screen also links to `https://business.facebook.com/billing_hub/accounts` and states plainly
that Meta bills for conversations and we do not mark that up. No API involvement.

---

## 3. Template authoring

### `POST /templates`

```jsonc
{
  "name": "order_shipped_update",
  "category": "marketing",
  "language": "en_US",
  "headerKind": "none",
  "headerText": "",
  "bodyText": "Hi {{1}}, your order {{2}} has shipped.",
  "footerText": "Reply STOP to opt out",
  "buttons": [{ "kind": "quick_reply", "label": "Track order", "value": "" }]
}
```

`category`: `marketing` | `utility` | `authentication`.
`headerKind`: `none` | `text` | `image` | `video` | `document`.
`buttons[].kind`: `quick_reply` | `url` | `phone_number`.

**Creating and submitting are one step.** There is no draft state: Meta owns approval, and a local
draft would show a status the customer cannot act on. The response is the created template with
`status: "pending"`.

The client already enforces what Meta will reject, so these should rarely fire — but enforce them
anyway, since the client is not the authority:

| Rule | Code |
| --- | --- |
| Name is lowercase, digits and underscores, ≤ 512 chars | `422 validation_failed` |
| Body non-empty, ≤ 1024 chars, not a lone placeholder | `422 validation_failed` |
| Placeholders run `1..n` with no gaps | `422 validation_failed` |
| Header ≤ 60, footer ≤ 60, button label ≤ 25, ≤ 3 buttons | `422 validation_failed` |
| Name already used in this WABA | `409 template_name_taken` |

### `PUT /templates/{id}`

**Only a rejected template may be edited.** Meta treats an approved one as immutable; changing it
means a new template under a new name. Reject an edit to anything else with
`409 template_not_editable`. A successful edit resubmits it: return `status: "pending"` and clear
`rejectionReason`.

### Re-categorisation

The composer carries a prominent warning that Meta re-categorises on content, not on the category
claimed — a "utility" template containing an offer becomes marketing, at a higher rate. If Meta
returns a category different from the one submitted, **store what Meta returned**, not what was
asked for. The UI displays `category` as fact.

---

## 4. Media

### `POST /whatsapp/media`

`multipart/form-data`: `file`, plus `kind` (`image` | `video` | `document` | `audio`).

The client never uploads to Meta directly — the API holds the credential, uploads, and returns the
handle:

```jsonc
{
  "id": "med_901",
  "kind": "image",
  "fileName": "promo.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 184320,
  "url": "/api/v1/whatsapp/media/med_901",
  "uploadedAt": "2026-08-16T09:14:00Z"
}
```

**Limits the client enforces first; enforce them again:**

| Kind | Accepted | Max |
| --- | --- | --- |
| image | JPEG, PNG | 5 MB |
| video | MP4, 3GP | 16 MB |
| document | PDF, Word, Excel | 100 MB |
| audio | AAC, MP3, M4A, OGG | 16 MB |

**Audio is conversation-only.** It is valid in a reply and never in a template or campaign, so the
campaign picker does not offer it. Reject `kind: "audio"` on a campaign.

### `GET /whatsapp/media/{id}`

Raw bytes with a `Content-Type`. Needs the bearer token — the client fetches as a blob. Tenant-scoped:
another tenant's id returns **404**, not 403.

Nothing scans these uploads today unless you add it. They are shown to staff in the inbox, so
sandbox anything rendered inline.

---

## 5. Inbox — the 24-hour window

This is the whole point of the feature: Meta only allows free-form replies for 24 hours after the
customer's last inbound message. Outside it, an approved template is the only way through.

### `GET /whatsapp/conversations?page&pageSize&search`

Paged, **newest activity first**. `search` matches contact name or phone number.

```jsonc
{
  "id": "cnv_1",
  "contactId": "con_1",
  "contactName": "Amara Okafor",
  "phoneNumber": "+44 7700 900123",
  "lastMessagePreview": "Could you send the receipt?",
  "lastMessageAt": "2026-08-16T09:10:00Z",
  "unreadCount": 2,
  "windowExpiresAt": "2026-08-17T09:06:00Z"
}
```

- **`windowExpiresAt` is the field the whole screen turns on.** It is the customer's last inbound
  message + 24 hours, and **`null` once the window has closed**. The client ticks a countdown from
  it every 30 seconds and closes the composer when it reaches zero.
- `contactId` is `null` when the number is not a saved contact.

### `GET /whatsapp/conversations/{id}/messages?page&pageSize`

**Oldest first**, so the thread renders in reading order.

```jsonc
{
  "id": "msg_4",
  "direction": "inbound",
  "kind": "audio",
  "body": "",
  "media": { "id": "med_voice_1", "kind": "audio", "url": "/api/v1/whatsapp/media/med_voice_1", … },
  "status": "delivered",
  "failureReason": null,
  "templateName": null,
  "occurredAt": "2026-08-16T09:04:00Z"
}
```

`direction`: `inbound` | `outbound`.
`kind`: `text` | `image` | `video` | `document` | `audio` | `template` | `system`.
`status`: `queued` | `sent` | `delivered` | `read` | `failed`.

`templateName` is set on outbound template sends so the thread can label them.

### `POST /whatsapp/conversations/{id}/messages`

```jsonc
{ "conversationId": "cnv_1", "kind": "text", "body": "Receipt is on its way.", "mediaId": null }
```

`kind` here is `text` | `image` | `video` | `document` | `audio` only — a template send goes through
the campaign path, not here.

**`409 window_closed` once the window has shut.** The client blocks it first, but the server owns
the clock: a tab left open for an hour will try. The client handles this code specifically —
it refreshes and tells the user to use a template — so please use exactly that code.

Also expect `409 not_connected` when no WhatsApp account is linked.

### `POST /whatsapp/conversations/{id}/read`

Clears `unreadCount`, returns the updated conversation. Idempotent.

### Realtime

Inbound messages should push over the existing `/hubs/realtime`. The client currently refetches on
the `resynced` signal, which works but is coarse. A dedicated event carrying the conversation id
would let the thread update in place — say the shape and I will wire it.

---

## 6. Signup: what happens server-side

The client hands you `code`, `wabaId` and `phoneNumberId`. Everything after that is yours.

**1 · Exchange the code.** `GET https://graph.facebook.com/{version}/oauth/access_token` with
`client_id`, `client_secret`, `code`. The app secret must never leave the server. You get back a
business integration token that does not expire the way user tokens do — but treat it as a
credential: encrypt at rest with the key already configured under `Security:EncryptionKeys`, the
same way the existing WhatsApp credential is stored.

**2 · Subscribe the app to the WABA.**
`POST /{wabaId}/subscribed_apps` — without this Meta sends you no webhooks at all, and the inbox
stays permanently empty. This is the step most often missed.

**3 · Register the phone number.**
`POST /{phoneNumberId}/register` with a 6-digit PIN you generate and store. Required before the
number can send.

**4 · Read the profile** — `GET /{phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`
and `GET /{wabaId}` for the messaging tier — and populate the connection record so
`GET /whatsapp/connection` answers immediately rather than on first sync.

Store, per tenant: WABA id, phone number id, encrypted token, display number, verified name,
quality rating, messaging tier, and the registration PIN.

**Idempotency.** A user who double-clicks, or retries after a network blip, must not create a second
connection. Key on `(tenantId, phoneNumberId)` and treat a repeat as an update.

---

## 7. Webhooks — the part that makes the inbox exist

`GET|POST /whatsapp/webhook` already exists as a route. What it needs to *do* is the largest piece
of work here, because **every inbound message and every status change arrives this way**. Without
it, `GET /whatsapp/conversations` returns an empty list forever.

### Verification (GET)

Meta calls once with `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. Compare the token
against `WhatsApp:WebhookVerifyToken` and echo `hub.challenge` as plain text. Any mismatch is 403.

### Delivery (POST)

**Verify the signature before parsing.** `X-Hub-Signature-256` is `sha256=` + HMAC of the *raw*
body using the app secret. Compute it on the raw bytes, not on re-serialised JSON — re-serialising
changes whitespace and the comparison fails. Use a constant-time compare. Reject with 401 on
mismatch; an unverified webhook is an unauthenticated stranger able to write into a customer's
inbox.

**Answer 200 immediately, then process.** Meta retries on non-200 and will disable the subscription
after repeated failures. Enqueue and return; do not do Graph calls inline.

### Resolving the tenant

The payload carries `entry[].id` — the WABA id — and `metadata.phone_number_id`. Resolve the tenant
from those. **There is no auth context on a webhook**, so this lookup *is* the tenancy boundary. An
unknown WABA id is dropped, not guessed at.

### Payload branches you must handle

`entry[].changes[].value` contains one of:

**`messages[]` — inbound.** For each:
- Find or create the conversation, keyed `(tenantId, waId)`.
- Match `waId` to an existing contact by normalised phone number; leave `contactId` null when there
  is no match rather than creating a contact silently.
- Insert the message with `direction: inbound`, mapping `type` → our `kind`
  (`text`/`image`/`video`/`document`/`audio`; `sticker`, `location`, `contacts` and the rest can map
  to `system` with a readable body until they are needed).
- **Reset the window**: `windowExpiresAt = message.timestamp + 24 hours`. This is the single most
  important line in the whole feature.
- Increment `unreadCount`, update `lastMessagePreview` and `lastMessageAt`.
- For media, store `media.id` and download the bytes — see §8.

**`statuses[]` — delivery receipts for outbound.** Map `sent`/`delivered`/`read`/`failed` onto the
message by its Meta message id. Carry `errors[].title` into `failureReason` so the thread can show
why something failed.

**`message_template_status_update` — Meta's verdict on a template.** Update `status` to
`approved`/`rejected`, and store `reason` in `rejectionReason`. Without this the template list shows
"pending" forever and the customer has to press Sync to learn anything.

**`template_category_update`** — Meta re-categorised a template. **Store what Meta says**, not what
was submitted. The UI warns the customer this can happen and then displays `category` as fact.

**`phone_number_quality_update`** and account updates — refresh `qualityRating` and
`messagingTier` on the connection.

### Idempotency and ordering

Meta redelivers, and out of order. Key on the Meta message id with a unique constraint and make a
duplicate a no-op — not an exception that fails the batch. For statuses, never move a message
*backwards*: a late `sent` arriving after `read` must be ignored, or the thread will appear to
regress.

---

## 8. Media lifecycle

**Meta media ids expire after 30 days.** Storing only the id means a six-week-old thread renders
broken images. On inbound, download the bytes with the business token and store them yourself
(blob storage or the filesystem), keeping the Meta id only for reference.

`GET /whatsapp/media/{id}` then serves *your* copy — which is also why it can be tenant-scoped and
authenticated, where a Meta URL could not be.

Outbound is the reverse: `POST /whatsapp/media` receives the file, uploads to
`POST /{phoneNumberId}/media`, and returns our own `MediaAsset` with the handle recorded. Validate
type and size **before** the upload, and store a copy so the sent message can still be previewed
later.

---

## 9. Sending

`POST /whatsapp/conversations/{id}/messages` maps onto `POST /{phoneNumberId}/messages`.

**Check the window server-side.** `windowExpiresAt` in the past ⇒ `409 window_closed` without
calling Meta. The client blocks it too, but a tab open for an hour will still try, and Meta's own
error for this is opaque.

Persist the message as `queued` *before* calling Meta, then update to `sent` with the returned
message id. If Meta fails, mark it `failed` with the reason — never lose the record, or the agent
sees their message vanish and sends it again.

Campaign sends are the same Graph call with a `template` payload; they already go through the
campaign dispatcher, which should reuse this path for status handling.

---

## 10. Voice

Decided deliberately: **inbound voice notes play inline; agents may attach an audio file; there is
no in-browser recording.** Nothing extra is needed server-side beyond `kind: "audio"` on media
upload and messages.

---

## 11. Permissions

Two new keys, added to the catalogue (now **51**):

- `whatsapp.inbox.view` — read conversations
- `whatsapp.inbox.reply` — send inside the window

The `/inbox` route is gated on `whatsapp.inbox.view` and the `whatsapp` plan module. Enforce both
server-side; the client gate is usability, not security.

---

## 12. Front-end status

| Piece | File |
| --- | --- |
| SDK loader, popup, code capture | `core/services/meta-signup.service.ts` |
| Meta app id / config id | `environments/environment.ts` → `meta` |
| Connection screen, tier, billing link, disconnect | `features/whatsapp/` |
| Template composer, preview, re-categorisation warning | `features/templates/template-editor.component.*` |
| Campaign builder gated on approved templates | `features/campaigns/campaign-builder.component.*` |
| Inbox, window countdown, composer | `features/inbox/` |
| Models, limits, window helpers | `core/models/whatsapp.model.ts` |

**Verified against the mock:** template name and placeholder validation reject `Order Update` and
`{{1}}…{{3}}`; submitting shows "With Meta for review"; the campaign picker offers only approved
templates and excludes the one just submitted; the inbox shows `23h 55m left`, `37m left` with a
warning, and a closed window that removes the composer and points at templates.

To exercise it without a backend, set `useMockApi: true` in `web/src/environments/environment.ts`.

---

## 13. Not built

- **No in-browser voice recording** (§6).
- **No conversation assignment or open/closed status** — one shared inbox, as scoped.
- **No template analytics** beyond the `timesUsed` already returned.
- **`headerKind` is not round-tripped.** `GET /templates` returns `headerText` but not the header
  *type*, so the campaign builder has to guess whether a template needs media. Adding `headerKind`
  to the template response would remove that guess — worth doing.

---

## 14. Suggested order of work

Each step leaves the product usable, which matters — the front end is already shipped and every
stage lights something up.

| # | Work | Unlocks |
| --- | --- | --- |
| 1 | `messagingTier` on the connection | Connection screen complete |
| 2 | Signup steps 2–4 in §6 (subscribe, register, profile) | Connecting a number actually works |
| 3 | `POST` / `PUT /templates` | Template authoring |
| 4 | Webhook: signature, verification, `message_template_status_update` | Templates stop saying "pending" forever |
| 5 | `POST /whatsapp/media` + `GET /whatsapp/media/{id}` | Campaign media picker |
| 6 | Webhook: `messages[]` → conversations, window reset | **Inbox has data** |
| 7 | `GET` conversations + messages + `/read` | Inbox reads |
| 8 | `POST` messages with the window check | Inbox replies |
| 9 | Webhook: `statuses[]` | Delivery ticks |
| 10 | SignalR push on inbound | Live inbox |

Steps 6–8 are the feature. Everything before them is groundwork.

---

## 15. Persistence sketch

Not prescriptive — but these are the fields the API contract requires you to be able to answer.

```
WhatsAppConnection   TenantId, WabaId, PhoneNumberId, EncryptedToken, DisplayPhoneNumber,
                     VerifiedName, QualityRating, MessagingTier, RegistrationPin,
                     WebhookHealthy, ConnectedAt

Conversation         Id, TenantId, WaId (customer number), ContactId?, ContactName,
                     LastMessagePreview, LastMessageAt, UnreadCount, WindowExpiresAt?
                     unique (TenantId, WaId)

Message              Id, TenantId, ConversationId, MetaMessageId (unique), Direction, Kind,
                     Body, MediaId?, Status, FailureReason?, TemplateName?, OccurredAt
                     index (ConversationId, OccurredAt)

MediaAsset           Id, TenantId, MetaMediaId?, Kind, FileName, MimeType, SizeBytes,
                     StoragePath, UploadedAt

MessageTemplate      + HeaderKind  ← see §13
```

Every table carries `TenantId` and the existing global query filter applies. The webhook path is the
one place with no auth context, so tenancy there comes from the WABA lookup — get that wrong and one
customer's messages land in another's inbox.

---

## 16. Rate limits and failure modes worth planning for

- **Meta throttles per phone number.** A campaign to 40,000 contacts cannot be a tight loop; the
  existing dispatcher's cadence should carry over.
- **Quality rating drops** when users block or report. `phone_number_quality_update` is how you
  learn; surface it and the existing screen already shows it.
- **The messaging tier caps unique customers per day**, not messages. A campaign can be within the
  send limit and still be refused for opening too many conversations.
- **Templates get paused** by Meta on poor feedback. `status: "paused"` already exists in our model.
- **Webhook subscription can be dropped** by Meta after repeated non-200s. Worth an alert, since the
  symptom is silent: everything looks fine and no messages arrive.
