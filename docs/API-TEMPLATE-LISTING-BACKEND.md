# Templates — Listing, Search, Filter and Paging: Backend Response

Answer to `API-TEMPLATE-LISTING.md`. Built to the contract as written — no shape changed, no
parameter renamed. Two things differ from what that document assumed, both in §3.

Base path: `/api/v1/templates`.

---

## 0. Status

| Method | Path | State |
| --- | --- | --- |
| GET | `/templates` | **Built.** Paged, searchable, filterable — §1 |
| GET | `/templates/counts` | **Built** — §2 |
| GET | `/templates/approved` | **Built.** New, and you need it — §3 |
| POST | `/templates` · PUT · DELETE · POST `/sync` | Unchanged |

**Caveat:** two performance indexes are still to be applied to the database. They do not change any
response, only how fast it is answered at scale. Everything below works today without them.

---

## 1. `GET /templates`

Exactly your §1. All five parameters, the `all` sentinel, AND semantics between filters, the
standard paged envelope, `totalItems` counted after filtering.

```
GET /templates?page=1&pageSize=10&search=shipped&status=approved&category=marketing
```

**Search covers name, body, header and footer** — you asked for name and body, and said header and
footer were welcome. All four are matched, case-insensitively, as substrings. Searching `shipped`
finds `order_shipped_v3` by its body text.

**Filtering and paging happen in SQL.** The server returns a page, not the collection.

**A page beyond the end returns empty `items` with the true `totalItems`**, not a 404.

**Ordering is `updatedAt` descending**, then name. A template someone just resubmitted is the one
they are looking for. No sort parameter yet; if you want one, `sortBy` / `sortDirection` matching
`/contacts` is what it will be.

### One thing to know about `pageSize`

**It is clamped to 100.** Ask for more and you get 100 — no error, no warning. This is a
platform-wide rule in `PageRequest`, not something specific to templates. It matters for §3.

---

## 2. `GET /templates/counts`

```jsonc
{ "total": 17, "approved": 10, "pending": 3, "rejected": 2, "paused": 2 }
```

Unfiltered, across the whole tenant, exactly as you argued. One grouped query, not five.

---

## 3. `GET /templates/approved` — please switch to this

You wrote that `listAllTemplates()` requests one large page and that an explicit endpoint "would be
a welcome addition". It is more than welcome: **the workaround does not actually work.**

`PageRequest.PageSize` is clamped to 100. `listAllTemplates()` asks for 500 and receives 100,
silently. A tenant with more than 100 approved templates would find the campaign wizard quietly
missing the hundred-and-first — the precise failure you were guarding against, one order of
magnitude further out. Nothing would error; the template simply would not be in the list.

Meta's default per-account ceiling is well above 100, so this is reachable, not theoretical.

```
GET /templates/approved   →   MessageTemplateResponse[]     (a bare array, unpaged)
```

Approved only, since nothing else can be sent. **Switch `listAllTemplates()` to this** — the
one-line change you offered. Do it before anything else in this document.

---

## 4. Route ordering — the collision you warned about is not there

You flagged `counts` competing with `{id}` and cited `/campaigns/preview-audience` as a live
instance. I checked both. Neither is a bug, for two independent reasons.

**There is no `GET /templates/{id}`.** The resource has never had one — the client reads templates
from the list. `counts` and `approved` compete with nothing. Same for campaigns: the only
single-segment POST is `preview-audience`; there is no `POST /campaigns/{id}` for it to shadow.

**And ASP.NET Core would resolve it anyway.** Attribute routing scores each segment and prefers
literals over parameters regardless of declaration order — unlike frameworks that match in
registration order. `/templates/counts` would win over `/templates/{id}` even if declared after it.

The caution was sound and cost nothing; the specific bug just is not present. If a
`GET /templates/{id}` is ever added it still will not collide.

---

## 5. Everything else held

- `TenantId` from the JWT, never from the client. List, counts and every filter scoped to the caller.
- All three endpoints behind `whatsapp.templates.view`, enforced at the API and not relying on the
  route guard.
- Counts in one grouped query.
- Indexes on `(TenantId, Status)` and `(TenantId, ModifiedOn)`. Category is deliberately unindexed:
  three values is too unselective to be worth an index once the tenant filter has run.

---

## 6. What to change

1. **Switch `listAllTemplates()` to `GET /templates/approved`** — §3. Do this first.
2. Let `normaliseTemplatePage` fall through to the paged branch; the array branch is now dead for
   this endpoint. Harmless to leave, but it will never fire again.
3. Nothing else. Toolbar, filters, paging, debounce, page-reset, empty states and the refetch-both
   behaviour all match what the server does.

Your §6 verification list should pass unchanged against the real API. If any item behaves
differently, that is a backend defect — tell me which one.
