# Multiple WhatsApp Numbers per Workspace — API Contract

**For the backend agent.** Today a workspace has exactly one WhatsApp connection. This makes it
many — as many as the plan allows — and lets an Admin decide, per employee and per number, who may
view, reply and broadcast.

The frontend is built against this document and runs on the mock API today. **Please implement these
shapes exactly**; anything you need to change, say so in your reply notes before building.

```
Workspace
  ├── Plan  ─────────────── limits.maxWhatsAppAccounts   (already exists)
  ├── WhatsApp accounts ─── #1 Sales · #2 Support · #3 Marketing
  │                         one is the workspace default
  └── Employees ─────────── per account: view / reply / broadcast
                            + their own default account
```

All routes under `/api/v1/`, standard envelope `{ data, message, traceId }`, enums camelCase unless
noted. `TenantId` never crosses the wire, as everywhere else.

---

## 0. Compatibility — nothing existing breaks

Every current single-connection endpoint keeps working and gains an **optional** `accountId` query
parameter. When omitted it means **the workspace default account**, so a client or integration that
knows nothing about multiple numbers behaves exactly as today.

| Existing route | Change |
| --- | --- |
| `GET /whatsapp/connection` | `?accountId=` optional; default account when absent |
| `POST /whatsapp/connection/sync` | `?accountId=` optional |
| `POST /whatsapp/disconnect` | `?accountId=` optional |
| `POST /whatsapp/connect`, `/connect/manual`, `/connect/resume` | **Create a new account**, or re-link an existing one (§2.4) |
| `GET /templates`, `/templates/counts`, `/templates/approved` | `?accountId=` optional — filters to that account's WABA |
| `POST /templates/sync` | `?accountId=` optional |
| `GET /whatsapp/conversations` | New filters, §4 |
| `POST /campaigns` | New `whatsAppAccountId` field, §5 |

**Migration:** the existing connection row becomes account #1, flagged `isDefault: true`, labelled
from its verified name. Existing conversations, messages, templates and campaigns get its id.

---

## 1. The account

```ts
type ConnectionStatus = 'connected' | 'disconnected' | 'pending' | 'error';   // unchanged
type QualityRating    = 'green' | 'yellow' | 'red';                           // unchanged
type MessagingTier    = 'tier_250' | 'tier_1k' | 'tier_10k' | 'tier_100k' | 'unlimited';

type WhatsAppAccessPermission = 'view' | 'reply' | 'broadcast';

interface WhatsAppAccount {
  id: string;                    // "wa_…", public id
  label: string;                 // Admin-chosen, e.g. "Sales". Unique per workspace, 1–40 chars
  displayPhoneNumber: string;    // "+92 300 1234567"
  verifiedName: string;          // Meta's verified business name
  wabaId: string;                // templates belong to a WABA; two numbers may share one
  phoneNumberId: string;
  status: ConnectionStatus;
  qualityRating: QualityRating;
  messagingTier: MessagingTier;
  messagingLimit: number;
  messagesLast24h: number;
  tokenExpiresAt: string | null; // null = no stated expiry (system-user token), NOT expired
  connectedAt: string | null;
  isDefault: boolean;            // exactly one account is true whenever any exist
  /** What the CALLER may do on this number. Admins get all three. */
  myPermissions: WhatsAppAccessPermission[];
  health: WhatsAppAccountHealth;
}

interface WhatsAppAccountHealth {
  /** Outcome of the most recent Graph API call made for this account. */
  apiStatus: 'ok' | 'degraded' | 'down' | 'unknown';
  /** Meta's phone number status, passed through: CONNECTED, PENDING, FLAGGED, RESTRICTED… */
  phoneNumberStatus: string | null;
  /** WABA review status, passed through: APPROVED, PENDING, REJECTED… */
  accountStatus: string | null;
  lastWebhookAt: string | null;
  lastMessageSentAt: string | null;
  lastMessageReceivedAt: string | null;
  /** Plain-language. Never a raw Meta error body, code or token. */
  lastError: string | null;
}
```

The client derives the traffic light (🟢 / 🟡 / 🔴) from these fields itself, so **no summary field is
needed** — see §7 for the exact rules, in case you want the backend to agree.

---

## 2. Account endpoints

### 2.1 `GET /whatsapp/accounts`

Returns only the accounts the caller may **view**. An employee with no access to any number gets
`items: []` — a 200, not a 403.

```ts
interface WhatsAppAccountList {
  items: WhatsAppAccount[];
  /** plan.limits.maxWhatsAppAccounts. null = unlimited. */
  limit: number | null;
  /** Accounts in the WORKSPACE (not just the visible ones) counting against the limit. */
  used: number;
  /** The caller's own default: employee default ?? workspace default ?? null. */
  myDefaultAccountId: string | null;
}
```

**What counts against `used`:** every account not deleted, whatever its status. A disconnected number
still occupies a slot until it is removed (§2.5), otherwise an admin could exceed the plan by
disconnecting and reconnecting.

Permission: any member with `whatsapp.templates.view`, `whatsapp.connect` or
`whatsapp.inbox.view` (i.e. whoever can see any WhatsApp screen). Module: `whatsapp`.

### 2.2 `GET /whatsapp/accounts/{id}` → `WhatsAppAccount`

404 for an account in another workspace **or one the caller may not view**.

### 2.3 `PATCH /whatsapp/accounts/{id}` → `WhatsAppAccount`

```json
{ "label": "Support" }
```

| Status | errorCode | When |
| --- | --- | --- |
| 422 | `validation_failed` | Label empty or over 40 characters (`errors.label`) |
| 409 | `whatsapp_label_taken` | Another account in the workspace has that label (case-insensitive) |

Permission: `whatsapp.connect`.

### 2.4 Connecting — `POST /whatsapp/connect` (and `/connect/manual`, `/connect/resume`)

Body unchanged, plus an optional label:

```json
{ "code": "…", "wabaId": "…", "phoneNumberId": "…", "label": "Sales" }
```

- `phoneNumberId` **already belongs to this workspace** → re-link that account (refresh the token,
  status back to `connected`). Does not use a new slot.
- **New number** → create an account. Label defaults to `verifiedName`; de-duplicate by appending
  " 2", " 3". The first account ever created is the default.
- Response stays a `WhatsAppConnection`, now with **`accountId`** added so the client can select it.

| Status | errorCode | When |
| --- | --- | --- |
| 409 | `whatsapp_account_limit_reached` | `used >= limit`. Message states the limit: "Your plan includes 3 WhatsApp numbers." |
| 409 | `whatsapp_number_in_use` | That phone number is connected to **another** workspace |

**Check the limit before exchanging the code with Meta**, not after — otherwise the number is
registered at Meta and then refused here, which leaves it half-connected.

### 2.5 `POST /whatsapp/accounts/{id}/default` → `WhatsAppAccount[]`

Makes this the workspace default and returns **every** visible account, because the previous
default's `isDefault` flipped too. Only a `connected` account may be the default →
409 `whatsapp_account_not_connected`. Permission: `whatsapp.connect`.

### 2.6 `POST /whatsapp/accounts/{id}/sync` → `WhatsAppAccount`

Pulls status, quality, tier and profile from Meta for this one number, and updates `health`.

### 2.7 `POST /whatsapp/accounts/{id}/disconnect` → `WhatsAppAccount`

Revokes the token and unsubscribes webhooks; status → `disconnected`. **Keeps** the row, its
conversations and its employee assignments, so reconnecting the same number restores everything.
If it was the default, the default moves to the oldest remaining connected account (or none).

### 2.8 `DELETE /whatsapp/accounts/{id}` → 204

Frees the slot. Only allowed while `disconnected` → otherwise 409 `whatsapp_account_connected`.
Conversation history is kept (read-only, still filterable by this account); employee assignments to
it are removed. Permission: `whatsapp.disconnect`.

---

## 3. Employee access per number

### 3.1 Shape

```ts
interface WhatsAppAccess {
  accountId: string;
  permissions: WhatsAppAccessPermission[];   // non-empty; see rules
}

// Added to the existing Employee response:
interface Employee {
  // …existing fields…
  whatsAppAccess: WhatsAppAccess[];
  defaultWhatsAppAccountId: string | null;
}
```

### 3.2 `PUT /employees/{id}/whatsapp-access` → `Employee`

Replaces the employee's access wholesale.

```json
{
  "access": [
    { "accountId": "wa_sales",   "permissions": ["view", "reply"] },
    { "accountId": "wa_support", "permissions": ["view", "reply", "broadcast"] }
  ],
  "defaultAccountId": "wa_support"
}
```

Validation (422 `validation_failed`, field-keyed):

- `reply` or `broadcast` **require** `view` — reject rather than silently add it.
- No duplicate `accountId`; every id must belong to the workspace.
- `defaultAccountId` must be `null` or one of the ids in `access`.
- An empty `access` array is valid: the employee then sees no WhatsApp number.

Admins cannot be given access rows — they always have full access to every number
(409 `role_derived_permissions`, the code already used for role-derived permissions).

Permission: `settings.employees`.

### 3.3 On invite

`POST /employees/invite` accepts the same two optional fields:

```json
{
  "email": "sara@example.com",
  "name": "Sara Khan",
  "jobTitle": "Marketing",
  "permissions": ["whatsapp.inbox.view", "whatsapp.inbox.reply"],
  "whatsAppAccess": [{ "accountId": "wa_marketing", "permissions": ["view", "reply"] }],
  "defaultWhatsAppAccountId": "wa_marketing"
}
```

### 3.4 How the two permission layers combine — **the important rule**

The global permissions say **what kind of thing** someone may do. Per-account access says **on which
number**. **Both must allow it.**

| Action | Global permission | AND per-account |
| --- | --- | --- |
| See conversations of a number | `whatsapp.inbox.view` | `view` |
| Reply in a conversation | `whatsapp.inbox.reply` | `reply` on the conversation's account |
| Assign a conversation | `whatsapp.inbox.reply` | `reply` on its account |
| Create / send a campaign | `whatsapp.campaigns.create` / `.send` | `broadcast` on the campaign's account |
| See templates of a number | `whatsapp.templates.view` | `view` |

Refused → **403 with `errorCode: "whatsapp_account_forbidden"`**, and a message naming the number
("You don't have reply access to Support."). Keep 404 for "doesn't exist / other workspace".

Enforce this in the **query**, not only on writes: an employee without `view` on Marketing must never
receive a Marketing conversation from any list, search or realtime event.

---

## 4. Inbox

### 4.1 `GET /whatsapp/conversations`

New query parameters, all optional:

| Param | Values | Meaning |
| --- | --- | --- |
| `accountId` | account id | Only this number. Absent = every number the caller may view |
| `status` | `all` · `unread` · `awaiting_reply` · `replied` | `awaiting_reply` = the last message is inbound. `replied` = the last message is outbound |
| `assignedTo` | `all` · `me` · `unassigned` · `{userId}` | Conversation assignment, §4.3 |
| `messageType` | `all` · `text` · `media` · `template` | Kind of the **last** message. `media` = image, video, document or audio |
| `search`, `page`, `pageSize` | unchanged | |

`all` is a real value meaning "no filter", matching the convention already used on contacts.

`Conversation` gains:

```ts
interface Conversation {
  // …existing fields…
  accountId: string;
  accountLabel: string;       // denormalised so the list needs no second lookup
  awaitingReply: boolean;     // last message is inbound
  assignedTo: { id: string; name: string } | null;
}
```

### 4.2 Sending a reply

No request change — the account is the conversation's. Refused with 403
`whatsapp_account_forbidden` without `reply` on it. A reply is always sent **from the number the
customer wrote to**, never from the default.

### 4.3 `POST /whatsapp/conversations/{id}/assign` → `Conversation`

```json
{ "userId": "usr_12" }      // or null to unassign
```

- The assignee must have `view` on the conversation's account → 422 `validation_failed`
  (`errors.userId`: "Ali cannot see the Support number.").
- Caller needs `reply` on the account (or is an Admin).
- Push a realtime `conversationAssigned` event with the updated `Conversation`, so another agent's
  list updates.

### 4.4 Realtime

`inboundMessage` gains `accountId` and `accountLabel`. **Send it only to users who may view that
account** — today it goes to the whole tenant group, which after this change would leak one number's
customers to employees who cannot see it. Per-user delivery (you already have `NotifyUserAsync`) is
the simplest correct option.

---

## 5. Campaigns

`POST /campaigns` and `PUT /campaigns/{id}` gain:

```json
{ "whatsAppAccountId": "wa_sales" }
```

- **Required** when the workspace has more than one account. With exactly one it may be omitted and
  means that account.
- The template must belong to the account's WABA → 422 `validation_failed`
  (`errors.templateId`: "This template belongs to a different WhatsApp account.").
- Caller needs `broadcast` on the account → 403 `whatsapp_account_forbidden`.
- The account must be `connected` **at send time**, not only at creation → 409
  `whatsapp_account_not_connected`, and the campaign stays unsent rather than failing every message.

`Campaign` responses gain `whatsAppAccountId: string` and `whatsAppAccountLabel: string`.

`GET /campaigns` accepts `?accountId=` to filter.

---

## 6. Plans and usage — mostly already there

- **`limits.maxWhatsAppAccounts` already exists** on plans. It is the limit in §2.
- **Usage:** add a `whatsAppAccounts` metric to `GET /subscription` → `usage[]`. The key already
  exists in the client's `UsageMetricKey` union, and the subscription screen renders every metric it
  receives as a usage bar — **no client change needed**:

```json
{ "key": "whatsAppAccounts", "label": "WhatsApp numbers", "used": 4, "limit": 5, "unit": "numbers" }
```

- **Downgrade:** a plan change that would leave `used > limit` → 409 `downgrade_blocked` (already a
  known code), with a message saying how many numbers to remove first.

---

## 7. Health — how the client shows 🟢 🟡 🔴

Derived client-side in `whatsapp-account.model.ts` (`accountHealth()`), listed so the backend can
agree or push back:

| Light | When (first match wins) |
| --- | --- |
| 🔴 **Down** | `status` is `disconnected` or `error` · `apiStatus` is `down` · token already expired · `qualityRating` is `red` |
| 🟡 **Attention** | `status` is `pending` · token expires within 7 days · `apiStatus` is `degraded` · `qualityRating` is `yellow` · connected but no webhook for 24 hours · `phoneNumberStatus` is `FLAGGED` or `RESTRICTED` |
| 🟢 **Healthy** | everything else |

"No webhook for 24 hours" matters most: it is the only signal that Meta has stopped delivering, and
nothing else on the screen would reveal it. Please keep `lastWebhookAt` accurate.

---

## 8. Error codes introduced

| Status | errorCode | Where |
| --- | --- | --- |
| 409 | `whatsapp_account_limit_reached` | Connect |
| 409 | `whatsapp_number_in_use` | Connect |
| 409 | `whatsapp_label_taken` | Rename |
| 409 | `whatsapp_account_not_connected` | Set default, send campaign |
| 409 | `whatsapp_account_connected` | Delete while connected |
| 403 | `whatsapp_account_forbidden` | Any per-account action without that account's permission |

All 409s above are shown by the client from `detail`, so please make each message a complete
sentence a user can act on.

---

## 9. Order of work

| # | Work | Unblocks |
| --- | --- | --- |
| 1 | `WhatsAppAccount` table + migration of the existing connection to account #1 | Everything |
| 2 | `GET /whatsapp/accounts` + `?accountId=` on existing endpoints | Selector, WhatsApp page |
| 3 | Connect creates accounts; limit check; default/rename/sync/disconnect/delete | Multiple numbers |
| 4 | `whatsAppAccess` on employees + enforcement in queries | Per-employee access |
| 5 | Inbox filters + `accountId`/`assignedTo` on conversations + assign | Inbox filtering |
| 6 | Campaign `whatsAppAccountId` + template/WABA check | Campaigns per number |
| 7 | `health` fields populated from webhook + Graph calls | Status monitoring |
| 8 | Per-user realtime delivery | Correctness: no cross-number leak |

## 10. Questions

1. **One WABA or many?** Can numbers in a workspace belong to different WABAs? The contract allows it
   (templates filter by the account's `wabaId`); please confirm the data model does too.
2. **Assignment permission:** is `reply` on the account the right gate for assigning, or should it be
   Admin-only?
3. **Auto-reply** is workspace-wide today. Should it become per-account? The client can add an
   account selector to that screen once the endpoint takes `accountId`.
