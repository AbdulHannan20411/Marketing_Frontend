# Audience Module — API Specification

Complete backend contract for the **Contacts**, **Groups** and **Tags** screens.

This is a companion to [`API-REQUIREMENTS.md`](./API-REQUIREMENTS.md), which defines the response
envelope, error format, authentication and tenancy rules that apply to everything here. Read §1–§5 of
that document first; this one does not repeat them.

Front-end sources this was derived from:
`features/contacts/`, `features/groups/`, `features/tags/`,
`core/services/contacts.service.ts`, `core/models/contact.model.ts`.

---

## 1. What the screens do

Knowing the UI behaviour matters, because several requirements below exist only because of it.

### Contacts (`/contacts`)

A paged table, **12 rows per page**. Above it: a search box, a status filter, a group filter and a
"Clear" button. Each row has a checkbox; the header checkbox selects the visible page.

**Selection survives pagination.** The user can tick rows on page 1, move to page 3, tick more, and act
on all of them at once. The client therefore sends an explicit array of ids to bulk endpoints — never
"apply to current filter". When any row is selected a bulk bar appears with **Add tag**, **Assign
group** and **Delete**. The page header has **Import contacts** and **Export**.

Each row shows: avatar with initials, full name, email (falling back to phone), phone, country, up to
two tags plus a `+N` overflow, status badge, and relative last-messaged time.

### Groups (`/groups`)

A card grid. Each card shows name, description, **contact count**, and relative updated time, with a
per-card actions menu. Header has **New group**.

### Tags (`/tags`)

A card grid. Each card shows the tag name in its colour, **tagged contact count**, and a bar sized
relative to the largest tag. Header has **New tag**.

---

## 2. Data model

### 2.1 Contact

```ts
type ContactStatus = 'subscribed' | 'unsubscribed' | 'blocked';

interface Contact {
  id: string;                  // "cnt_0001"
  fullName: string;
  initials: string;            // server-computed, see below
  phoneNumber: string;         // E.164, display spacing allowed
  email: string | null;
  country: string;             // display name, e.g. "United Kingdom"
  status: ContactStatus;
  tagIds: string[];
  groupIds: string[];
  optedInAt: string | null;
  lastMessagedAt: string | null;
  createdAt: string;
}
```

Field rules:

| Field | Rule |
| --- | --- |
| `initials` | Computed server-side from `fullName` (first letter of first and last word, uppercased). The client renders it directly and does not derive it. |
| `phoneNumber` | Stored normalised to E.164. May be returned with display spacing (`+44 7700 900123`); the client treats it as an opaque string. **Uniqueness is enforced on the normalised form.** |
| `email` | Nullable. The table falls back to `phoneNumber` when null. |
| `country` | Human-readable name, not an ISO code — it is rendered verbatim. Derive it from the phone number's country code or an explicit field on create. |
| `status` | `subscribed` only when consent exists. See §7.1. |
| `optedInAt` | Non-null when `status` is `subscribed`; null otherwise. |
| `tagIds` / `groupIds` | Always arrays, never null. Empty array when none. |

### 2.2 Group

```ts
interface ContactGroup {
  id: string;                  // "grp_1"
  name: string;
  description: string;         // never null — empty string when unset
  contactCount: number;        // server-computed
  createdAt: string;
  updatedAt: string;
}
```

### 2.3 Tag

```ts
type TagColor = 'brand' | 'info' | 'warning' | 'danger' | 'neutral';

interface ContactTag {
  id: string;                  // "tag_1"
  name: string;
  color: TagColor;             // exactly these five values — see §7.4
  contactCount: number;        // server-computed
  createdAt: string;
}
```

---

## 3. Contacts endpoints

All are **scopable** — they accept `?adminId=` when the caller is a `SuperAdmin` viewing as an Admin
(see `API-REQUIREMENTS.md` §5.2). Every response must be filtered to the resolved tenant.

### 3.1 List contacts

```
GET /api/v1/contacts
```

| Query | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | int, 1-based | `1` | |
| `pageSize` | int | `12` | Client sends 12. Cap at 100. |
| `search` | string | `""` | Case-insensitive **substring** match across `fullName`, `phoneNumber`, `email`. Empty means no filter. |
| `status` | string | `"all"` | `all` \| `subscribed` \| `unsubscribed` \| `blocked` |
| `groupId` | string | `"all"` | `all` or a group id |
| `adminId` | string | — | SuperAdmin scoping only |

> **Critical:** the client sends the literal string `"all"` for `status` and `groupId` when the filter is
> off — not an empty string, not an omitted parameter. Treat `"all"` as "no filter". Failing to do this
> returns zero rows on first load, which is the single most likely integration bug in this module.

Filters combine with AND. Sort by `createdAt` descending unless told otherwise.

**Response** — `PagedResult<Contact>`:

```jsonc
{
  "data": {
    "items": [
      {
        "id": "cnt_0001",
        "fullName": "Camila Weber",
        "initials": "CW",
        "phoneNumber": "+91 9860308",
        "email": "camila.weber@example.com",
        "country": "India",
        "status": "subscribed",
        "tagIds": ["tag_3", "tag_7"],
        "groupIds": ["grp_1"],
        "optedInAt": "2025-11-02T09:14:00Z",
        "lastMessagedAt": null,
        "createdAt": "2025-11-02T09:14:00Z"
      }
    ],
    "page": 1, "pageSize": 12, "totalItems": 148, "totalPages": 13
  },
  "message": null,
  "traceId": "0HN7…"
}
```

Permission: `contacts.view`.

**Recommended addition:** a `tagId` filter. The Tags screen shows per-tag counts and drilling into one
is the obvious next interaction, but there is currently no way to ask for it. Accept `tagId=all|<id>`
on the same endpoint.

### 3.2 Get one contact

```
GET /api/v1/contacts/{id}
```

Returns a single `Contact`. `404` if it does not exist **or belongs to another tenant** — never
distinguish the two, that leaks existence across tenants.

Permission: `contacts.view`.

### 3.3 Create contact

```
POST /api/v1/contacts
```

```ts
interface CreateContactRequest {
  fullName: string;
  phoneNumber: string;         // any format; server normalises to E.164
  email?: string | null;
  country?: string | null;     // derive from phone when omitted
  status?: ContactStatus;      // default "subscribed"
  tagIds?: string[];
  groupIds?: string[];
}
```

Returns the created `Contact` with `201`. Set `message` to a confirmation.

Failure modes:

| Condition | Status | Response |
| --- | --- | --- |
| Missing or malformed field | `422` | `errors` keyed by field name |
| Phone already exists in tenant | `409` | `detail` naming the existing contact |
| Plan contact limit reached | `422` | See §8 |
| Unknown `tagIds` / `groupIds` | `422` | `errors: { tagIds: ["…"] }` |

Permission: `contacts.create`.

### 3.4 Update contact

```
PUT /api/v1/contacts/{id}
```

Body is `CreateContactRequest` with all fields optional — **patch semantics**, apply only what is
present. Sending `tagIds` **replaces** the whole set; it is not additive. Same for `groupIds`. Use the
bulk endpoints (§3.7) when you want additive behaviour.

Returns the updated `Contact`.

Permission: `contacts.edit`.

### 3.5 Delete contact

```
DELETE /api/v1/contacts/{id}
```

Returns `data: null` with a confirmation `message`.

Deleting a contact must decrement the `contactCount` of every group and tag it belonged to. Prefer a
soft delete so message history and campaign metrics stay intact — but it must then disappear from every
list, count and export.

Permission: `contacts.delete`.

### 3.6 Bulk delete

```
POST /api/v1/contacts/bulk-delete
```

```jsonc
{ "ids": ["cnt_0001", "cnt_0042", "cnt_0107"] }
```

**Response** — a per-item outcome, because partial failure is normal:

```jsonc
{
  "data": { "requested": 3, "deleted": 2, "failed": [ { "id": "cnt_0107", "reason": "Already deleted." } ] },
  "message": "2 contacts deleted."
}
```

Return `200` even when some items fail; the client shows `message` and can surface `failed`. Reserve
`4xx` for a request that is wholly invalid.

Cap `ids` at 1000 per call and return `422` beyond that.

Permission: `contacts.delete`.

### 3.7 Bulk tag and bulk group

```
POST /api/v1/contacts/bulk-tag
POST /api/v1/contacts/bulk-group
```

```ts
interface BulkTagRequest   { ids: string[]; tagIds: string[];   mode?: 'add' | 'remove' | 'replace'; }
interface BulkGroupRequest { ids: string[]; groupIds: string[]; mode?: 'add' | 'remove' | 'replace'; }
```

`mode` defaults to `add`. The UI's "Add tag" and "Assign group" actions are additive — applying a tag a
contact already has is a no-op, not an error.

Same `BulkResult` response shape as §3.6. Recompute affected `contactCount` values before responding.

Permissions: `contacts.edit`.

### 3.8 Duplicate detection

```
GET /api/v1/contacts/duplicates
```

| Query | Notes |
| --- | --- |
| `strategy` | `phone` (default) \| `email` \| `name` |
| `page`, `pageSize` | Paged |

```ts
interface DuplicateGroup {
  matchValue: string;          // the normalised phone/email that collided
  strategy: 'phone' | 'email' | 'name';
  contacts: Contact[];         // 2+ entries
}
```

Returns `PagedResult<DuplicateGroup>`. Phone matching uses the normalised E.164 form, so
`+44 7700 900123` and `07700900123` (with a known country) must collide.

Merging:

```
POST /api/v1/contacts/merge
```

```jsonc
{ "keepId": "cnt_0001", "mergeIds": ["cnt_0044"], "fieldOverrides": { "email": "best@example.com" } }
```

The surviving contact takes the union of `tagIds` and `groupIds`, the earliest `createdAt`, the latest
`lastMessagedAt`, and any explicit `fieldOverrides`. Merged records are deleted. Returns the surviving
`Contact`.

Permission: `contacts.edit` (merge also requires `contacts.delete`).

### 3.9 CSV import

A **three-step flow**. Do not make this a single blocking upload — files run to tens of thousands of
rows and the UI is a wizard with a preview step.

**Step 1 — upload and preview**

```
POST /api/v1/contacts/import/preview      (multipart/form-data, field name: "file")
```

```ts
interface ImportPreview {
  uploadId: string;             // opaque handle, valid ~1 hour
  fileName: string;
  totalRows: number;
  detectedColumns: string[];    // headers as they appear in the file
  suggestedMapping: Record<string, string | null>;   // our field → their column, best guess
  sampleRows: Record<string, string>[];              // first 10 parsed rows, keyed by their column
  duplicatesInFile: number;     // rows colliding with each other
  duplicatesExisting: number;   // rows colliding with stored contacts
  invalidRows: { rowNumber: number; reason: string }[];   // cap at 50 in the response
}
```

Accept `.csv` up to 10 MB. Reject other content types with `422`.

Mappable target fields: `fullName`, `phoneNumber`, `email`, `country`, `status`, `tags`, `groups`.
`tags` and `groups` accept a delimited list in one cell — state your delimiter (suggest `;`) and create
any tag or group that does not exist.

**Step 2 — commit**

```
POST /api/v1/contacts/import/commit
```

```ts
interface ImportCommitRequest {
  uploadId: string;
  mapping: Record<string, string>;                       // our field → their column
  duplicateStrategy: 'skip' | 'update' | 'create';       // default "skip"
  defaultStatus?: ContactStatus;                         // for rows without a status column
  assignTagIds?: string[];                               // applied to every imported row
  assignGroupIds?: string[];
}
```

Returns `202 Accepted` with `{ jobId, status: "queued" }` when processing asynchronously, or the final
`ImportResult` directly for small files.

**Step 3 — poll**

```
GET /api/v1/contacts/import/{jobId}
```

```ts
interface ImportResult {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  processedRows: number; totalRows: number;
  created: number; updated: number; skipped: number; failed: number;
  errors: { rowNumber: number; reason: string }[];       // cap at 100
  completedAt: string | null;
}
```

The import must respect the plan's `maxContacts` (§8): stop at the ceiling, finish with
`status: "completed"`, and report the remainder in `skipped` with a clear reason rather than failing the
whole job.

Permission: `contacts.import`.

### 3.10 Export

```
GET /api/v1/contacts/export
```

Accepts **the same filters as §3.1** (`search`, `status`, `groupId`, `tagId`) so "export what I am
looking at" works, plus optional `ids` for "export my selection". `format` accepts `csv` (default) or
`xlsx`.

Two acceptable shapes — **say which you choose**, the client differs slightly:

1. **Direct stream** — `200` with `Content-Type: text/csv` and `Content-Disposition: attachment`. Simple,
   but the browser cannot attach the bearer token to a plain link, so the client must fetch as a blob.
2. **Signed URL** *(preferred)* — `202` with `{ "downloadUrl": "https://…", "expiresAt": "…" }`. Works
   for large exports and lets you generate asynchronously.

Columns: `fullName`, `phoneNumber`, `email`, `country`, `status`, `tags` (names, delimited), `groups`
(names, delimited), `optedInAt`, `lastMessagedAt`, `createdAt`.

Permission: `contacts.export`.

---

## 4. Groups endpoints

### 4.1 List groups

```
GET /api/v1/groups
```

Returns `ContactGroup[]` — **unpaged**, the UI renders a card grid. If a tenant could exceed ~200
groups, tell us and we will switch to `PagedResult`.

`contactCount` must equal the `totalItems` that `GET /contacts?groupId=<id>` returns. The two are shown
on adjacent screens and a mismatch is immediately visible.

Permission: `groups.manage`.

### 4.2 Create, update, delete

```
POST   /api/v1/groups
PUT    /api/v1/groups/{id}
DELETE /api/v1/groups/{id}
```

```ts
interface GroupRequest { name: string; description?: string; }
```

- `name` is required, 1–60 characters, **unique per tenant** (case-insensitive) — `409` on collision.
- `description` defaults to `""`, max 200 characters. Never return null.
- `POST` returns the created group with `contactCount: 0`.
- `PUT` is a patch; it must update `updatedAt`.
- `DELETE` removes the group and its memberships. **It must not delete the contacts.** Return `409` if
  the group is referenced by a scheduled campaign, naming the campaign in `detail`.

Permission: `groups.manage`.

### 4.3 Membership

```
POST   /api/v1/groups/{id}/contacts       { "contactIds": ["cnt_0001"] }   // add
DELETE /api/v1/groups/{id}/contacts       { "contactIds": ["cnt_0001"] }   // remove
GET    /api/v1/groups/{id}/contacts       ?page&pageSize                   // list members
```

The add/remove pair overlaps with `/contacts/bulk-group` (§3.7). Implement both — bulk-group is what the
contacts table calls, these are what a group detail screen will call. They must share one implementation
so counts cannot diverge.

`GET` returns `PagedResult<Contact>`, identical in shape to §3.1.

Permission: `groups.manage`.

---

## 5. Tags endpoints

### 5.1 List tags

```
GET /api/v1/tags
```

Returns `ContactTag[]`, unpaged. Same count-consistency rule as groups: `contactCount` must match a
`tagId` filter on `/contacts`.

Permission: `tags.manage`.

### 5.2 Create, update, delete

```
POST   /api/v1/tags
PUT    /api/v1/tags/{id}
DELETE /api/v1/tags/{id}
```

```ts
interface TagRequest { name: string; color?: TagColor; }
```

- `name` required, 1–40 characters, unique per tenant (case-insensitive) — `409` on collision.
- `color` must be one of `brand | info | warning | danger | neutral`. Default `neutral`. **Reject any
  other value with `422`** — the client maps these to specific styles and an unknown value renders an
  unstyled badge. Do not accept hex colours.
- `DELETE` removes the tag from every contact that carries it. Contacts are never deleted. This one is
  safe to perform without a confirmation gate on the server side, but return the affected count in
  `message`.

Permission: `tags.manage`.

### 5.3 Assignment

```
POST   /api/v1/tags/{id}/contacts     { "contactIds": [...] }
DELETE /api/v1/tags/{id}/contacts     { "contactIds": [...] }
```

Same relationship to `/contacts/bulk-tag` as §4.3 has to bulk-group — shared implementation.

Permission: `tags.manage`.

---

## 6. Permission matrix

| Endpoint | Permission |
| --- | --- |
| `GET /contacts`, `GET /contacts/{id}`, `GET /contacts/duplicates` | `contacts.view` |
| `POST /contacts` | `contacts.create` |
| `PUT /contacts/{id}`, `POST /contacts/bulk-tag`, `POST /contacts/bulk-group`, `POST /contacts/merge` | `contacts.edit` |
| `DELETE /contacts/{id}`, `POST /contacts/bulk-delete` | `contacts.delete` |
| `POST /contacts/import/*` | `contacts.import` |
| `GET /contacts/export` | `contacts.export` |
| All `/groups*` | `groups.manage` |
| All `/tags*` | `tags.manage` |

Enforce server-side regardless of what the UI shows. A user with `contacts.view` but not
`contacts.delete` never sees the Delete button, but must still receive `403` if they call the endpoint.

Note the module gate: the whole Audience area also requires the tenant's plan to include the `crm`
module. A tenant without it should receive `403` on every endpoint here.

---

## 7. Validation rules

### 7.1 Consent and status

- `subscribed` requires a non-null `optedInAt`. Reject a create/update that sets `subscribed` without it
  (or set it to "now" server-side and say so).
- `unsubscribed` and `blocked` must clear `optedInAt` to null.
- A `blocked` or `unsubscribed` contact must be **excluded from campaign audiences** regardless of group
  or tag membership. This is a compliance requirement, not a UI preference.
- Status transitions are always allowed except `blocked → subscribed`, which should require an explicit
  re-opt-in and return `422` otherwise.

### 7.2 Phone numbers

- Normalise to E.164 on write. Reject unparseable numbers with `422`.
- Uniqueness is per tenant on the normalised value.
- When a country cannot be inferred and none is supplied, return `422` rather than guessing.

### 7.3 Names and emails

- `fullName` 1–120 characters, trimmed, must contain a non-whitespace character.
- `email` optional; when present must be a valid address. **Not unique** — households share addresses.

### 7.4 Tag colours

Only the five enum values. This bears repeating because a "let the user pick a hex" feature request will
break the UI: the client maps each value to a Tailwind class set, and unknown values render unstyled.

---

## 8. Plan limits

The Audience module is limited by `maxContacts` on the tenant's plan.

- **Create** — when at the ceiling, return `422`:

  ```jsonc
  {
    "title": "Contact limit reached",
    "detail": "Your Growth plan allows 25,000 contacts. Upgrade to add more.",
    "errors": {}
  }
  ```

  The client already renders an upgrade prompt from this.

- **Import** — do not fail the whole job. Import up to the ceiling, count the rest as `skipped`, and
  explain in the result (§3.9).

- **Usage reporting** — the `contacts` entry in `GET /subscription` → `usage` must reflect the live
  count. It drives the gauge, the "limit reached" state and the dashboard widget, so a stale nightly
  figure will show the wrong thing.

- **SuperAdmin exemption** — a `SuperAdmin` is never subject to these limits, including while scoped to
  an Admin via `adminId`. Enforce the limit against the *scoped tenant's* plan for data integrity, but do
  not block the SuperAdmin on their own account.

---

## 9. Consistency rules

These are the invariants that make the three screens agree with each other. Most integration bugs in
this module are violations of one of them.

1. `ContactGroup.contactCount` **equals** `GET /contacts?groupId=<id>` → `totalItems`.
2. `ContactTag.contactCount` **equals** the count for that tag (needs the `tagId` filter, §3.1).
3. Deleting a contact decrements every group and tag count it belonged to.
4. Deleting a group or tag never deletes contacts.
5. Bulk operations recompute counts **before** responding — the client refetches immediately and will
   show stale numbers otherwise.
6. `Contact.tagIds` and `Contact.groupIds` only ever contain ids that still exist. Purge references when
   a tag or group is deleted.
7. Counts are per tenant. Under `adminId` scoping they are the *scoped* tenant's counts.

---

## 10. Open questions

1. **Soft or hard delete for contacts?** Soft preserves campaign history and is what we would recommend,
   but it must be invisible to every list, count and export.
2. **Leads and Customers** — `PlatformOverview` reports both, but no Audience screen exposes them. Are
   they derived from contacts (a status or tag), or separate entities needing their own endpoints?
3. **Export delivery** — direct stream or signed URL (§3.10)? Affects the client.
4. **Import size** — what row count should we design the wizard around? It determines whether step 2 is
   synchronous or always a job.
5. **Custom fields** — is a per-tenant custom attribute set planned? If so, say now: it changes
   `Contact`, the import mapping and the filter contract substantially, and is painful to retrofit.
6. **Group membership** — static lists only, or dynamic rule-based segments ("all contacts tagged VIP in
   the UK")? The current model assumes static. Dynamic groups would need a rule definition on
   `ContactGroup` and a different `contactCount` computation.
