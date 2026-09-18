# WhatsApp Inbox — Not Implemented On The API

**For the backend agent.** A user reports "WhatsApp is connected but the Inbox is not working".
Diagnosis: **the inbox is complete on the client and absent on the API.** Nothing is broken — the
endpoints do not exist, and no inbound message is ever stored.

The full contract was handed over earlier in **`docs/API-WHATSAPP-MESSAGING.md`** (§4 Media, §5 Inbox,
§7 Webhooks, plus the entity sketch and the order-of-work table near the end). This note is the
status, the evidence, and the smallest path to a working inbox. **Please implement against that
document rather than inventing a second shape.**

---

## 1. Evidence

Probed against the running API (`https://localhost:7108`, no token — so 401 means "route exists",
404 means "no such route"):

| Route | Result |
| --- | --- |
| `GET /api/v1/whatsapp/conversations` | **404** |
| `POST /api/v1/whatsapp/media` | **404** |
| `GET /api/v1/whatsapp/connection` | 401 (exists) |
| `GET /api/v1/templates` | 401 (exists) |
| `GET /api/v1/dashboard` | 401 (exists) |

In the backend source:

- No `InboxController`, and `WhatsAppController` declares no `conversations` or `media` route.
- No `Conversation` or `Message` entity. `Entities/WhatsApp.cs` holds only `WhatsAppConnection`,
  `WhatsAppOnboardingStep` and `MessageTemplate`.
- `WhatsAppWebhookService` returns early unless `value.Statuses` is present, so the `messages[]`
  array — every inbound customer message — is dropped without being read.
- `RealtimeService` on the client has no conversation event, matching the hub.

So: the number is connected, delivery receipts work, and customer replies are discarded.

## 2. What the client already calls

All six exist in `core/services/whatsapp.service.ts` and are exercised today against the mock
backend, so the shapes are settled:

| Method | Route |
| --- | --- |
| GET | `/whatsapp/conversations?page&pageSize&search` → `PagedResult<Conversation>` |
| GET | `/whatsapp/conversations/{id}` → `Conversation` |
| GET | `/whatsapp/conversations/{id}/messages?page&pageSize` → `PagedResult<ConversationMessage>`, **oldest first** |
| POST | `/whatsapp/conversations/{id}/messages` → `ConversationMessage` |
| POST | `/whatsapp/conversations/{id}/read` → `Conversation` (idempotent) |
| POST | `/whatsapp/media` (multipart `file`, `kind`) → `MediaAsset` |

### Wire shapes the client expects

```ts
Conversation = {
  id, contactId: string | null, contactName, phoneNumber,
  lastMessagePreview, lastMessageAt,           // ISO 8601
  unreadCount: number,
  windowExpiresAt: string | null               // null once the 24h window is shut
}

ConversationMessage = {
  id, direction: 'inbound' | 'outbound',
  kind: 'text' | 'image' | 'video' | 'document' | 'audio' | 'template',
  body, media: MediaAsset | null,
  status: MessageDeliveryStatus, failureReason: string | null,
  templateName: string | null, occurredAt
}

MediaAsset = { id, kind, fileName, mimeType, sizeBytes, url, uploadedAt }

SendMessageRequest = { conversationId, kind, body, mediaId: string | null }
```

`MediaAsset.url` is fetched **with the auth header** by the client's `SecureImageComponent`, so it
must be an API route on our own domain, never a Meta URL and never a public link.

## 3. Smallest path to a working inbox

1. **Store inbound messages.** In `WhatsAppWebhookService`, handle `value.Messages` alongside
   `value.Statuses`: resolve the tenant from `metadata.phone_number_id`, find or create the
   conversation keyed `(TenantId, WaId)`, insert the message keyed on `MetaMessageId` (unique, so a
   Meta retry is idempotent), set `LastMessageAt`, bump `UnreadCount`, and set
   `WindowExpiresAt = message timestamp + 24h`. **This step alone is what makes the inbox non-empty.**
2. **Read endpoints.** The three GETs, tenant-scoped, `[RequirePermission(whatsapp.inbox.view)]`.
3. **Reply endpoint.** POST messages, `[RequirePermission(whatsapp.inbox.reply)]`, refusing with
   409 `window_closed` when the window has shut — the client blocks it first, but the server owns the
   clock.
4. **Media.** Upload proxy plus the authenticated download route behind `MediaAsset.url`.
5. **Realtime.** A conversation event on the hub. Until then the client only refreshes on reconnect,
   which works but means a reply can sit unseen.

**Also required, and easy to miss:** `POST /{wabaId}/subscribed_apps` during signup. Without it Meta
sends no webhooks at all, so step 1 never receives anything even once it is written. Worth checking
for already-connected accounts too, including the one the user has connected now.

## 4. Permissions and gating — already in place

`Permissions.WhatsApp.InboxView` (`whatsapp.inbox.view`) and `InboxReply`
(`whatsapp.inbox.reply`) already exist in `Permissions.cs`, and the client gates the route and the
composer on them. Gate the new endpoints on those two plus `[RequireModule(PlanModules.WhatsApp)]`.

## 5. Client change made alongside this note

A 404 from `/whatsapp/conversations` used to render "Conversations are temporarily unavailable —
try again", which loops forever against a route that does not exist. It now reads "The inbox is not
available yet", with no retry button. When the endpoints ship, that message disappears on its own;
nothing needs removing.

## 6. Questions

1. **Is the inbox in scope now, or later?** If later, say so and the client can hide the tab instead
   of showing an unavailable screen.
2. **Is `subscribed_apps` being called at signup today?** If not, no webhook has ever arrived for
   any tenant, which also affects delivery receipts.
3. **Media storage:** local disk (as `Storage:RootPath`) or object storage? The client only needs the
   authenticated URL, so either is fine — we just need to know a 24-hour Meta media id is not being
   handed back as a permanent link.
4. **Retention:** how long are conversations and messages kept? Nothing in the client assumes
   forever.
