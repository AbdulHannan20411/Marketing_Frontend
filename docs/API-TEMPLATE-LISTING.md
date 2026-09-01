# Templates — Listing, Search, Filter and Paging

What the backend needs to provide for the templates screen. The Angular front end is **already
built against this contract** and runs today against an in-memory mock of it. Match the shapes
below and the UI needs no changes.

Base path: `/api/v1/templates`.

---

## 0. What changes, and what does not

`GET /templates` currently returns a bare array of every template. That is what has to change: it
becomes paged, searchable and filterable. Everything else on the resource — create, resubmit,
delete, sync — is unchanged.

| Method | Path | State |
| --- | --- | --- |
| GET | `/templates` | **Changes** — gains query parameters and a paged envelope (§1) |
| GET | `/templates/counts` | **New** (§2) |
| POST | `/templates` | Unchanged |
| PUT | `/templates/{id}` | Unchanged |
| DELETE | `/templates/{id}` | Unchanged |
| POST | `/templates/sync` | Unchanged |

**The client accepts both shapes.** Until the paged envelope ships, an array response is filtered
and sliced client-side so the screen behaves identically — see `normaliseTemplatePage` in
`core/services/whatsapp.service.ts`. Nothing breaks on the day you deploy, and nothing needs
removing afterwards; the client simply stops doing the work itself.

---

## 1. `GET /templates`

```
GET /templates?page=1&pageSize=10&search=shipped&status=approved&category=marketing
```

| Parameter | Values | Notes |
| --- | --- | --- |
| `page` | ≥ 1 | 1-based |
| `pageSize` | 10 · 20 · 50 | The client offers these three; accept any sane value |
| `search` | free text | Matches **name and body text** — see below |
| `status` | `all` · `approved` · `pending` · `rejected` · `paused` | |
| `category` | `all` · `marketing` · `utility` · `authentication` | |

**`search` must match the body, not just the name.** An operator hunting for the template that
mentions "shipped" will not remember it is called `order_shipped_v3`. Case-insensitive, substring,
across `name` and `bodyText`. Searching the header and footer too is welcome; searching only the
name is the one thing that will feel broken.

**Filters send the literal `all` when cleared**, matching the convention `/contacts` already set, so
you never have to distinguish "parameter absent" from "filter cleared".

**Combine filters with AND.** `status=approved&category=marketing` means both.

### Response

The standard paged envelope, items unchanged from today's `MessageTemplate`:

```jsonc
{
  "data": {
    "items": [ /* MessageTemplate, exactly as returned today */ ],
    "page": 1,
    "pageSize": 10,
    "totalItems": 17,
    "totalPages": 2
  },
  "message": null,
  "traceId": "…"
}
```

`totalItems` is the count **after filtering** — it drives "Showing 1–10 of 17" and the page count.

**A page beyond the end returns an empty `items` with the true `totalItems`**, not a 404. The client
can land there after deleting the last template on the final page.

### Ordering

Newest-updated first (`updatedAt` descending) unless you have a reason to prefer another default.
The client does not currently send a sort parameter; if you add one, `sortBy` / `sortDirection`
matching `/contacts` would be the consistent choice.

---

## 2. `GET /templates/counts`

```
GET /templates/counts?search=shipped&category=marketing
```

```jsonc
{ "total": 17, "approved": 10, "pending": 3, "rejected": 2, "paused": 2 }
```

Counts across **every page**, not just the current one. They render as badges on the status chips,
and "3 pending" is the single most common reason this screen is opened — a page of ten cannot
answer it.

### Which filters apply — this is the subtle part

**`search` and `category` apply. `status` does not.**

`status` is excluded because these counts *are* the breakdown by status. Applying it would leave the
selected chip showing the total and every other chip at zero, and the numbers would jump every time
the operator clicked a chip.

`search` and `category` are different dimensions and **must** apply. They are the filters the list
is already narrowed by, so a count computed without them describes a different set of templates than
the one on screen — a chip reading "Pending 1" beside an empty list, which tells the operator the
filter is broken when it is working perfectly.

The test: **the four status counts must always sum to `total`, and `total` must equal the
`totalItems` the list returns when `status=all` under the same `search` and `category`.** If those
two numbers can disagree, the scoping is wrong.

The client refetches the counts when search or category changes, and deliberately does not when
status changes.

A failure here is not fatal — the client drops the badges and shows the chips unnumbered rather than
erroring the page. But it is a cheap query and worth having.

### ⚠️ Live bug — `CountTemplatesAsync` ignores the filters

`WhatsAppService.CountTemplatesAsync(CancellationToken)` takes **no parameters**. It groups every
template in the tenant by status and returns that, regardless of `search` or `category`.

The symptom, reported from production: with **category = Authentication** selected and the list
correctly empty, the chips read **All 1 · Pending 1** — the workspace's one pending *Marketing*
template, counted under a category it does not belong to. The user reasonably reads that as the
filter being broken.

**The fix is to accept `search` and `category` and apply them to the grouped query**, exactly as §2
describes. Status still must not be applied — that is the breakdown itself.

Until then the client is no longer affected: because `GET /templates` still returns the **whole
collection** unpaged, the client now derives the counts from that same array under the same filters
and ignores the endpoint's answer. That is exact, not a guess. The moment `GET /templates` returns a
real page, the client can no longer see the whole set, stops deriving counts, and goes back to
trusting this endpoint — so **the two changes need to land together**, or the counts break again.

### ⚠️ Route ordering — this one will bite

---

## 3. Multi-tenancy and permissions

Unchanged from the rest of the resource: `TenantId` is resolved from the JWT and never sent by the
client. The list, the counts and every filter are scoped to the caller's tenant.

Both endpoints sit behind the existing `templates.view` permission. An employee without it should
not reach the screen at all — the route guard handles that — but the API must not rely on the guard.

---

## 4. Performance notes

**Filter in SQL, not in memory.** The point of this change is that the server stops returning every
template. Fetching all of them to filter in the application would leave the work exactly where it is
now, just moved.

**Index what is filtered.** `(TenantId, Status)`, `(TenantId, Category)` and `(TenantId, UpdatedAt)`
cover the common paths. The body-text search is a `LIKE '%…%'` scan; at realistic template counts —
Meta's own per-account ceiling is low — that is fine, and full-text indexing is not worth it yet.

**Counts in one query**, grouped by status, rather than five `COUNT(*)` round trips.

---

## 5. Front-end status

| Piece | File |
| --- | --- |
| `TemplateQuery`, `TemplateStatusCounts`, status/category labels | `core/models/whatsapp.model.ts` |
| `listTemplates`, `listAllTemplates`, `countTemplates`, dual-shape normaliser | `core/services/whatsapp.service.ts` |
| Toolbar, filters, paging, empty states | `features/templates/templates.component.*` |

`listAllTemplates()` requests one large page and exists for the pickers — the campaign wizard offers
every approved template to choose from, and a page of ten would silently hide the eleventh. If you
would rather it did not ask for 500 rows, an explicit `GET /templates/approved` returning the bare
list would be a welcome addition; the client can switch to it in one line.

### Behaviour worth matching

- Search is debounced 300 ms and de-duplicated, so typing does not fire a request per keystroke.
- Changing any filter, or the page size, resets to page 1 — the row an operator was looking at is
  unlikely to still be on the current page.
- Deleting the last card on a page steps back a page rather than stranding them on an empty one.
- Creating, resubmitting, deleting or syncing refetches **both** the page and the counts; refreshing
  only the list would leave the chip badges quietly stale.
- The empty state distinguishes "no templates match those filters" from "no templates yet" and
  offers the right action for each.

---

## 6. Verified

Against the mock, which filters and pages server-side exactly as this document asks:

- 17 seeded templates, 10 per page, "Showing 1–10 of 17", "Page 1 of 2"; page 2 shows 11–17.
- Status chips read All 17 · Approved 10 · Pending 3 · Rejected 2 · Paused 2, and sum correctly.
- **With the mock emulating the deployed backend** — bare unpaged array, unfiltered counts —
  selecting Authentication shows All 2 · Approved 2 · Pending 0 with two cards, and then selecting
  Pending shows **Pending 0** beside the empty state. The endpoint's unfiltered 17/10/3/2/2 is
  correctly ignored.
- Filtering to a category with no pending templates shows **Pending 0**, not a stale count, and the
  chips stop claiming templates the list does not contain. Selecting that empty status shows the
  "no templates match" state beside a chip reading 0, which agree with each other.
- Searching `sale` rescopes the counts to All 2 · Approved 1 · Pending 1, which still sum to All.
- Clicking between statuses does **not** move the numbers.
- Selecting **Pending** returns exactly the three pending templates.
- Searching `shipped` matches `order_shipped_v3` by its **body text**, not its name.
- Search plus an incompatible status filter shows the "no templates match those filters" empty
  state, not the "no templates yet" one.
- Changing category while on page 2 resets to page 1.
- **Clear** resets search, status and category together and then hides itself.
- The pager disappears when the result fits on one page.
- No horizontal scroll at 375 px.

To exercise it without a backend, set `useMockApi: true` in `web/src/environments/environment.ts`.
