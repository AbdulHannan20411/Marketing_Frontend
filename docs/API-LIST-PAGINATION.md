# List Endpoints — Server-Side Pagination

Raised because several screens were downloading an entire collection to display ten rows. This is
the audit, what the client now does, and what the API still owes.

**The rule:** a list endpoint returns one page. The next page is another request. No endpoint backing
a paginated screen may return an unbounded collection.

---

## 1. Audit

| Screen | Endpoint | Before | Now |
| --- | --- | --- | --- |
| Contacts | `GET /contacts` | ✅ paged | ✅ |
| Admin → Tenants | `GET /admin/tenants` | ✅ paged | ✅ |
| Admin → Audit | `GET /admin/audit` | ✅ paged | ✅ |
| Superadmin → Payments | `GET /payment-requests` | ✅ paged | ✅ |
| Reports → Failures | `GET /reports/failures` | ✅ paged | ✅ |
| **Campaigns** | `GET /campaigns` | ❌ **entire collection, sliced in the browser** | ⚠️ client sends paging; **API must honour it** |
| **Templates** | `GET /templates` | ⚠️ params sent, bare array returned | ⚠️ still awaiting server paging |
| **Inbox** | `GET /whatsapp/conversations` | ❌ **hard-capped at 50, rest unreachable** | ✅ paged, with Load more |

Unpaginated but bounded, and deliberately left alone: `/groups`, `/tags`, `/employees`,
`/permission-sets`, `/plans`, `/notifications`, `/superadmin/admins`. None has a paginator and none
is expected to grow without limit. Say if any of them can, and I will page them too.

---

## 2. `GET /api/v1/campaigns` — the main one

Was returning every campaign in the workspace with **no query parameters at all**. The browser then
filtered, sorted and sliced. At a few thousand campaigns that is a multi-megabyte response to render
ten rows.

The client now sends:

```
GET /campaigns?page=1&pageSize=10&search=&status=all
```

| Param | Notes |
| --- | --- |
| `page` | 1-based |
| `pageSize` | user-selected; 10/25/50/100 |
| `search` | matches **campaign name and template name** — an operator hunting for "the one that used the shipping template" will not remember the campaign's name |
| `status` | one of the campaign statuses, or the literal `all` |

`all` is a real wire value, matching the contacts convention, so the API never has to distinguish
"absent" from "cleared".

**Response** — the standard `PagedResult`:

```jsonc
{ "items": [ /* … */ ], "page": 1, "pageSize": 10, "totalItems": 1420, "totalPages": 142 }
```

**Until then, nothing breaks.** The service accepts a bare array too and slices client-side, exactly
as it does for templates today, flagging `pagedByServer: false`. That is a bridge, not the
destination — while it holds, the whole collection is still on the wire.

---

## 3. `GET /api/v1/campaigns/summary` — new, and needed *because* of paging

The four tiles above the list (Active, Messages sent, Delivery rate, Read rate) describe **the whole
workspace**. They were computed from the full array — which is the one thing that array was
genuinely needed for.

A page of ten cannot answer "how many campaigns are active". Computing tiles from the visible rows
would make them change as the user clicks Next, which is worse than showing nothing.

```jsonc
{ "active": 3, "sent": 357046, "delivered": 346335, "read": 256288 }
```

- `active` = `sending` + `scheduled`.
- **Ignores `search` and `status`.** These are workspace totals; applying the list's filters would
  make them agree with the table and stop meaning anything. This is the same rule
  `GET /templates/counts` is supposed to follow and currently does not.
- Rates are computed client-side from `sent`/`delivered`/`read`; send the counts, not percentages.

The client fetches this **once** per screen visit and re-fetches only after a mutation (pause,
cancel, send) — not on every page change, since the numbers do not depend on the page.

### ⚠️ Route ordering — this will bite

`/campaigns/summary` must be registered **before** `/campaigns/{id}`, or `summary` is read as a
campaign id, missed, and answered `404`.

This is not hypothetical. My own mock has a `/^\/campaigns\/([^/]+)$/` router, I added the summary
route after it, and it 404'd immediately — the tiles rendered as zeros. Same collision
`/templates/counts` and `/campaigns/preview-audience` have.

Probing the live API, `GET /campaigns/summary` currently returns `401` rather than `404`, which is
consistent with it being matched as an id. Worth checking before you assume it is unimplemented.

---

## 4. `GET /api/v1/whatsapp/conversations` — silently truncated

The inbox asked for `page=1&pageSize=50` and **stopped**. Not "fifty then paginate" — fifty, full
stop. The fifty-first conversation did not exist as far as the screen was concerned, with nothing
on the page to suggest otherwise. For a workspace with steady inbound traffic that is a permanent
blind spot, not a slow list.

Now pages properly at 30 with a **"Load N more"** control that appends, using `totalItems` to say
how many remain. Endpoint contract is unchanged — it already paged; the client simply was not using
it.

Two client-side fixes went with it:

- **Removed a duplicate search filter.** `search` was sent to the API *and* re-applied in the
  browser over name and phone only. Since the server also matches message bodies, the second filter
  was silently discarding conversations the server had correctly matched.
- **De-duplicated on append**, so a conversation whose last message lands between two page requests
  cannot appear twice after the list reorders.

---

## 5. `GET /api/v1/templates`

Still returns a bare array while `page`, `pageSize`, `search`, `status` and `category` are all being
sent. Unchanged from the earlier note — flagged again only because it is the same defect and belongs
in one list. Same `PagedResult` shape as above.

---

## 6. What the client does with live updates now

Campaign progress arrives over SignalR. `upsert` used to prepend an unknown campaign to the array —
correct when the array was everything. With a page of ten that would inject a row the current filter
and page never asked for, and leave eleven rows on screen. It now updates only rows already on the
page and ignores the rest.

---

## 7. Verified

Against the mock, with `/campaigns` paging and filtering server-side:

- Page 1 → 10 rows, *"Showing 1–10 of 14"*.
- Next → 4 rows, *"Showing 11–14 of 14"*, **no overlap** with page 1.
- Status → Drafts → *"Showing 1–2 of 2"*, filtered by the API, not the browser.
- Tiles read Active 3 · 357,046 sent · 97.0% · 74.0% and **do not change** between pages — they
  describe the workspace, the table describes the page.
- Search is debounced at 300 ms so a burst of typing is one request, not one per keystroke.

Production build clean.

---

## 8. One question

**Should `search` also match campaign *content*** — the rendered template body — or only the two
names? Name matching is what the client did before, so that is what I have specified, but if the
API can reach the body cheaply it is probably what an operator expects. Your call; the client needs
no change either way.
