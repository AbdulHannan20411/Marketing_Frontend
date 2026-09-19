# Multiple WhatsApp Numbers — Backend Implementation Notes

For the frontend agent. The backend now implements `API-MULTI-WHATSAPP-BACKEND.md`. The shapes match
the contract, except for the points in **§1 Differences**. Read those first.

All routes are under `/api/v1/` and use the standard envelope.

---

## 1. Differences from the contract

| # | Contract | Built | What the client does |
| --- | --- | --- | --- |
| 1 | Assignee ids look like `usr_12` | **`emp_12`**, the id every employee screen already uses. `usr_` is also accepted on input. | Send and expect `emp_` ids in `assign` and `assignedTo`. |
| 2 | `409 whatsapp_number_already_connected` (old code) | Renamed **`whatsapp_number_in_use`**, as the contract's §2.4 says. | Only handle the new code. |
| 3 | Admin rows in `whatsAppAccess` | An admin's **`whatsAppAccess` is `[]`**. Admins hold every number through their role, not through rows. | For role `Admin`, show "All numbers". Don't render an empty matrix. |
| 4 | `messageType` filter | Uses the kind of the **last message**, as specified. A thread with no messages matches none of `text`, `media` or `template`. | None. |
| 5 | Employee access enum type | Serialised exactly as `view` / `reply` / `broadcast`. It is named `WhatsAppAccessLevel` internally because of a code-analysis rule. | None. |
| 6 | Template writes | `POST /templates` also accepts **`?accountId=`**, the number whose business account (WABA) the template is submitted to. It defaults to the workspace default. Edit and delete use the template's own WABA automatically. | Pass the selected account when creating a template. |
| 7 | Media upload | `POST /whatsapp/media` also accepts **`?accountId=`**. Meta's media handle belongs to the number that uploaded it. | Pass the conversation's `accountId` when uploading an attachment for a reply. Pass the campaign's `accountId` when uploading for a campaign. |
| 8 | `GET /campaigns` | Accepts `?accountId=`, and `all` means no filter. It is **not** narrowed by per-number view access. Campaign lists are still gated only by the global permissions. | None. Filter by account in the UI if you want. |
| 9 | Template WABA mismatch on a campaign | `422 validation_failed`, `errors.templateId`, as specified. This replaces the old `409 template_not_on_connected_account` for create and update. | Show it under the template field. |
| 10 | Endpoints called without `accountId` | They resolve to the **workspace default**, as specified. An employee who cannot view the default gets `403 whatsapp_account_forbidden` from `GET /whatsapp/connection`, `/templates` and similar. | Always send the selected `accountId` once the selector exists. |

---

## 2. Data model: what changed underneath

- **An account is the existing connection row.** The migration turns the existing row into account #1.
  - `isDefault = true`.
  - `label` comes from the verified name. If there is none, it falls back to the display number, then to "WhatsApp".
  - Every existing conversation and campaign is stamped with that account.
- **Conversations are per (number, customer).** A customer who writes to Sales and to Support gets two threads.
  - Each thread has its own 24-hour window, which is how Meta counts them.
  - Each thread is visible only to the people who can view that number.
- **Templates are unique per WABA.** Two numbers on different business accounts can each have an
  `order_update` template, and syncing one account never takes over the other's template.
- **Multiple WABAs per workspace are supported** (answer to §10 Q1).

---

## 3. Endpoints delivered

### Accounts

| Method | Route | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/whatsapp/accounts` | templates.view, connect or inbox.view (any one) | Returns only viewable accounts. An employee with no access gets `items: []` (200). `used` counts **every account in the workspace that isn't deleted**, disconnected ones included. |
| GET | `/whatsapp/accounts/{id}` | same | 404 if the account is in another workspace or not viewable. |
| PATCH | `/whatsapp/accounts/{id}` | whatsapp.connect | `422 errors.label`; `409 whatsapp_label_taken` (case-insensitive). |
| POST | `/whatsapp/accounts/{id}/default` | whatsapp.connect | Returns `WhatsAppAccount[]`. `409 whatsapp_account_not_connected`. |
| POST | `/whatsapp/accounts/{id}/sync` | whatsapp.connect | Refreshes status, quality, tier, profile, `phoneNumberStatus` and `accountStatus`. A failure is recorded in `health` and then returned as an error. |
| POST | `/whatsapp/accounts/{id}/disconnect` | whatsapp.disconnect | Keeps the row, its threads and its employee access. If it was the default, the default moves to the oldest connected number, or to none. |
| DELETE | `/whatsapp/accounts/{id}` | whatsapp.disconnect | Returns 204. `409 whatsapp_account_connected`. Removes access rows and clears anyone's default that pointed at it. The conversation history stays filterable by its id. |

- **`myDefaultAccountId`** is the first of these that the caller can view:
  1. the employee's own default;
  2. the workspace default;
  3. the first connected number;
  4. the first number of any status.
- **Disconnect** unsubscribes webhooks only when no other live number, in any workspace, uses the same WABA. Subscriptions belong to the WABA, not to the number.

### Connect (`/whatsapp/connect`, `/connect/manual`)

- The body takes an optional **`label`**. The response `WhatsAppConnection` now includes **`accountId`**.
- The plan limit and the "number in use" check run **before** the code is exchanged with Meta.
- Connecting a number this workspace already has is a **re-link**: it uses no new slot, and history and access are kept.
- A new number is named after its verified name, de-duplicated as "Acme 2". A label the user typed is refused on a clash, not renamed.
- The first number a workspace connects becomes the default. So does any number connected while the workspace has no default.
- `409 whatsapp_account_limit_reached`, for example: *"Your plan includes 3 WhatsApp numbers, and all of them are in use. Remove a disconnected number or upgrade your plan to connect another."*

### Existing routes that now take `?accountId=`

- `GET /whatsapp/connection`
- `POST /whatsapp/connection/sync`
- `POST /whatsapp/connect/resume`
- `POST /whatsapp/disconnect`
- `GET /templates`
- `GET /templates/counts`
- `GET /templates/approved`
- `POST /templates/sync`
- `POST /templates` (see §1 #6)
- `POST /whatsapp/media` (see §1 #7)
- `GET /campaigns`

---

## 4. Employees

- `PUT /employees/{id}/whatsapp-access` takes `{ access: [{ accountId, permissions }], defaultAccountId }` and returns `Employee`. It needs **settings.employees**.
- `POST /employees/invite` accepts `whatsAppAccess` and `defaultWhatsAppAccountId`.
- `Employee` gains `whatsAppAccess` and `defaultWhatsAppAccountId`.

Validation errors are `422 validation_failed`, keyed by field so you can put each one on its row:

| Key | When |
| --- | --- |
| `access[2].accountId` | Unknown number, or the same number listed twice |
| `access[2].permissions` | Empty, or `reply`/`broadcast` without `view` |
| `defaultAccountId` | The default is not one of the listed numbers |

On invite, the keys are `whatsAppAccess[i]…` and `defaultWhatsAppAccountId`.

- Giving an admin access rows returns **`409 role_derived_permissions`**.
- An empty `access` array is valid.
- Changes apply on the employee's **next request**. Access is read from the database, not from the token, so nobody is signed out.

---

## 5. Inbox

### Filters

`GET /whatsapp/conversations` takes these filters, with `all` meaning no filter:

| Filter | Values |
| --- | --- |
| `accountId` | An account id |
| `status` | `unread`, `awaiting_reply`, `replied` |
| `assignedTo` | `me`, `unassigned`, `emp_…` |
| `messageType` | `text`, `media`, `template` |

An invalid value returns a 422 on that field.

### Conversation fields

`Conversation` gains:
- `accountId`
- `accountLabel`
- `awaitingReply`
- `assignedTo: { id: "emp_…", name } | null`

### Access

- Access is enforced **in every query**: list, search, get by id, messages and mark-read.
- A thread on a number the caller cannot view returns 404.
- A deleted number's history stays filterable by admins.

### Replies

- A reply is always sent from the conversation's own number, never from the default.
- Without `reply` on that number the API returns `403 whatsapp_account_forbidden`, with a message naming the number.
- If that number is disconnected the API returns `409 not_connected`, naming the number.

### Assignment

`POST /whatsapp/conversations/{id}/assign` takes `{ "userId": "emp_12" | null }` and returns the `Conversation`.
- The caller needs `reply` on the number, or must be an Admin (answer to §10 Q2).
- If the assignee cannot view the number, the API returns `422 errors.userId`: "Ali cannot see the Support number."
- Realtime event **`conversationAssigned`** carries the updated `Conversation`.

### Realtime

- `inboundMessage` gains `accountId` and `accountLabel`.
- It is sent **per user**, only to Admins and to users who have both `whatsapp.inbox.view` and `view` on that number.
- `conversationAssigned` is sent the same way.
- **Nothing goes to the tenant group any more**, so drop any assumption that every connected tab receives it.

---

## 6. Campaigns

### Create and update

- `POST` and `PUT /campaigns` accept `whatsAppAccountId`.
- It is required when the workspace has more than one number. Otherwise the API returns `422 errors.whatsAppAccountId`.
- On `PUT`, leaving it out keeps the campaign's current number.
- The caller needs `broadcast` on the number, or gets `403 whatsapp_account_forbidden`.

### Send, run now and schedule

- **Send** and **run now** check that the number is connected. If it isn't, the API returns `409 whatsapp_account_not_connected` and the campaign stays unsent.
- **Schedule** checks `broadcast` only. The connection is checked again when the campaign fires.
- The dispatcher always sends from the **campaign's own number**, so changing the default never moves a scheduled campaign.

### Responses

Campaign responses gain `whatsAppAccountId` and `whatsAppAccountLabel`. Realtime `campaignProgress` includes them too.

---

## 7. Plans, usage and health

### Usage

The usage metric is now `{ key: "whatsAppAccounts", label: "WhatsApp numbers", unit: "numbers" }`.

### Downgrade

A downgrade that would leave the workspace over a limit returns `409 downgrade_blocked`. The message now says how many to remove, for example: *"…allows 2 numbers, and you are using 4. Remove 2 numbers (WhatsApp numbers) before switching."*

### Health fields

| Field | Written by |
| --- | --- |
| `lastWebhookAt` | Every webhook change for the number, including receipts and account updates. |
| `lastMessageReceivedAt` | Each inbound message. |
| `lastMessageSentAt` | Each accepted campaign send or inbox reply. |
| `apiStatus` | `ok` after a successful sync, onboarding run or send. `degraded` after a transient sync failure. `down` after a refused sync or a failed onboarding step. `unknown` after a disconnect. |
| `phoneNumberStatus` | Sync and onboarding, passed through from Meta's `status` field. |
| `accountStatus` | Sync and onboarding, passed through from Meta's `account_review_status` field. |
| `lastError` | Plain wording only. Never a Meta error body, code or token. |

The traffic-light rules in §7 of the contract match this data. Nothing needs changing server-side.

---

## 8. §10 answers

1. **Multiple WABAs:** yes. Templates are keyed per WABA and filtered by the selected account's `wabaId`.
2. **Assignment permission:** `reply` on the account, or Admin, as proposed.
3. **Auto-reply:**
   - Stays **workspace-wide** for now.
   - It already replies from the number each conversation belongs to.
   - A thread whose number is disconnected is skipped, not answered from a different number.
   - Per-account rules would be a new `accountId` on the auto-reply endpoints. Ask when you want that.
