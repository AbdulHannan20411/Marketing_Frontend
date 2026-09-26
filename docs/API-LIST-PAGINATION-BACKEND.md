# List Endpoints That Still Answer With Everything

Several list endpoints return the whole collection and leave the browser to filter, order and slice
it. That is fine at ten rows and wrong at ten thousand: the payload grows without limit, the first
paint waits for all of it, and a "page 2" button that never asks the server for anything is a lie
the moment somebody has more data than the demo.

This asks for paging on the endpoints where the collection grows. The client is already written for
it — **every screen below sends `page`, `pageSize`, `search`, `sortBy` and `sortDirection`
today** — so each endpoint switches over with no client change at all.

---

## 1. How the client already behaves

Each of these screens calls its endpoint with the full parameter set and adapts the answer:

```ts
// core/http/adaptive-page.ts
toAdaptivePage(response, query, { matches, compare })
```

- A **`PagedResult`** is used as it stands. The screen reads `items` and `totalItems`, and paging,
  searching and sorting are yours.
- A **bare array** is filtered, ordered and sliced in the browser, with exactly the same rules, and
  the page is flagged `pagedByServer: false`.

So the contract is: **the parameters are already being sent. Honour them and the client stops
compensating.** Nothing needs coordinating, there is no flag day, and each endpoint can land on its
own.

## 2. The endpoints, in the order they matter

| Endpoint | Grows with | Also needs |
| --- | --- | --- |
| `GET /superadmin/admins` | every customer you sign | `search`, `status`, sort |
| `GET /groups` | the workspace's segmentation | `search`, sort |
| `GET /tags` | the workspace's tagging habits | `search`, sort |
| `GET /employees` | the team, bounded by plan seats | `search`, `status`, sort |
| `GET /billing/history` | every month, forever | paged per tab — see §4 |

The first three are wired and waiting. `GET /employees` and the billing history are described in §4
because they need a decision first.

### The shape

```
GET /groups?page=1&pageSize=12&search=winter&sortBy=name&sortDirection=ascending
→ 200 { "data": { "items": [...], "page": 1, "pageSize": 12,
                  "totalItems": 340, "totalPages": 29 } }
```

Same `PagedResult` every other paged route already returns, same `PageRequest` binding, same
`ApplySort` allow-list. Suggested sort keys, matching what the client sends:

- **groups** — `id`, `name`, `contactCount`, `createdAt`, `updatedAt`
- **tags** — `id`, `name`, `color`, `contactCount`, `createdAt`
- **admins** — `id`, `organisation`, `name`, `plan`, `status`, `messagesThisMonth`,
  `employeeCount`, `contactCount`, `createdAt`, `lastActiveAt`

`search` matches the same fields the client matches when it has to do it itself: group name and
description; tag name; admin organisation, admin name and email.

### One thing to keep

**When no paging parameters are sent, keep answering with the whole collection.** Those endpoints
have a second caller that genuinely needs every row:

- `/groups` and `/tags` fill the pickers on the contacts screen — the filter dropdowns, the editor,
  the bulk bar. A page of twelve would silently hide the rest, and the person would never know the
  tag they wanted exists.
- `/superadmin/admins` backs the platform search and the security index.

Absent `page` ⇒ everything, as now. Present `page` ⇒ a `PagedResult`. The client already
distinguishes the two by the shape that comes back, so this costs you one `if` and costs me
nothing.

## 3. What is deliberately **not** asked for

Paging these would add a request and a spinner to lists that are short by construction:

- **Plans** (`/admin/plans`, `/plans`) — a platform has a handful, and the pricing page needs all of
  them at once anyway.
- **Email templates** — a fixed set, keyed by name, presented as a grouped navigator.
- **WhatsApp accounts** — bounded by the plan's `maxWhatsAppAccounts`, usually one to five.
- **Payment channels** — three rows of configuration.
- **Permission sets** — one per role shape, a handful.
- **Device sessions** (`/auth/sessions`) — one person's own devices.

If any of those ever grows past a screenful, the same adapter is already in place and the switch is
the same one-line change.

## 4. Two that need a decision first

**`GET /employees`.** Happy to page it, but the screen also shows seat usage across the whole team
("14 of 25 seats") and a permissions panel that needs the roster. Paging the list alone would leave
those describing one page. Either:

- (a) include the counts in the paged response — `activeCount`, `invitedCount`, `suspendedCount`
  beside `totalItems` — which is the shape `/campaigns/summary` already established; or
- (b) add `GET /employees/summary` and I will fetch it once per screen.

Say which and I will wire it. Until then the screen keeps reading the whole team, which is bounded
by the plan's seat limit and so is not urgent.

**`GET /billing/history`.** One payload carrying invoices, payments and renewals, each rendered as
its own tab. Over a few years the invoice list alone is unbounded. Three paged routes would be the
honest answer —`/billing/invoices`, `/billing/payments`, `/billing/renewals` — but that is three
endpoints for a screen nobody opens weekly. Your call on whether it is worth it; if you would
rather leave it, say so and I will stop asking.

## 5. What this changes for the client, per endpoint

| When you ship | What happens here |
| --- | --- |
| `/groups`, `/tags` paged | Group and tag screens stop loading every row; the picker calls stay unpaged |
| `/superadmin/admins` paged | The customer list stops loading every account; platform search still reads them all until §2 of `API-PLATFORM-SEARCH-BACKEND.md` lands |
| Nothing | Everything keeps working exactly as it does now |

That last row is the point: none of this is blocking, and none of it needs a coordinated release.
