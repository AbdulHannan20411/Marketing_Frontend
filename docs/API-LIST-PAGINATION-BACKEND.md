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

---

## 6. Update — paging landed, search and sort did not

Reported by the user as "search in Tags and Groups is not working". It is not the client; the
parameter is sent and dropped.

`/groups`, `/tags` and `/superadmin/admins` now page, which is most of §2 and it works. But
`OptionalPageRequest` carries a `Search` that two of the three never read:

```csharp
// ContactService.GetGroupsAsync — query.Search is never touched
var projected = _groups.Query()
    .OrderBy(group => group.Name)          // …and sortBy is never read either
    .Select(group => new { … });

if (query.WantsPage) projected = projected.Skip((page - 1) * size).Take(size);
```

| Endpoint | Pages | Searches | Sorts |
| --- | --- | --- | --- |
| `GET /superadmin/admins` | ✅ | ✅ `WhereMatchesAdminSearch` | ❌ `OrderBy(displayName)` |
| `GET /groups` | ✅ | ❌ accepted, ignored | ❌ `OrderBy(name)` |
| `GET /tags` | ✅ | ❌ accepted, ignored | ❌ `OrderBy(name)` |

**Accepting a parameter and ignoring it is worse than rejecting it.** A 400 saying "this endpoint
does not search" would have been visible in an afternoon. A 200 carrying page one of *everything*
is indistinguishable from a correct answer — the list simply never narrows, and the client cannot
tell, because twenty-five rows out of four hundred is exactly what a correct search would also
look like.

### What the client does in the meantime

It asks for a page only when the endpoint can answer the whole question:

```ts
const GROUPS_SERVER_SUPPORT: ServerListSupport = { search: false, sort: false };
// → a search or a sort omits page/pageSize entirely, the endpoint answers with
//   the collection as it does for the pickers, and the browser filters, orders
//   and slices it.
```

So a plain first load of Groups is still one page from the server, and only a search or a sort
falls back to the whole collection. Admins keeps server paging for search — which it performs —
and falls back only for sort.

This is a workaround, not the answer: it means the very lists that are long enough to need
searching are the ones that get fetched whole in order to search them.

### What is needed

1. **Apply `Search` in `GetGroupsAsync` and `GetTagsAsync`** — group name and description, tag
   name, case-insensitive contains, applied to `projected` *before* `Skip`/`Take` **and** before
   the `CountAsync`. Note the count is currently taken from the unfiltered `_groups.Query()`, so it
   needs to move inside the filter too or `totalItems` will describe rows the search removed.
2. **Honour `sortBy` / `sortDirection` on all three**, through the same `ApplySort` +
   `SortableColumns` allow-list the contacts list already uses. Keys as listed in §2 of this
   document — they are what the client sends today.
3. Then tell me, and the three flags above flip to `{ search: true, sort: true }`. That is the
   entire client change.

Worth a test on your side that a search returns *fewer* rows than no search, on a dataset larger
than one page. That is the assertion that would have caught this.

---

## 7. Employees and plans — wired, and what each still needs

Both asked for by the user. The state of play, checked against your code rather than guessed:

| Endpoint | Pages | Searches | Sorts | Client sends |
| --- | --- | --- | --- | --- |
| `GET /employees` | ✅ | ✅ name + email | ❌ `OrderBy(displayName)` | page, pageSize, search, sortBy, sortDirection |
| `GET /admin/plans` | ❌ | ❌ | ❌ | the same five, plus `status` |

### `/employees` — only the sort is missing

Paging and search both work, so the team table now reads one page and searches on the server. The
only gap is ordering: `sortBy` is sent and dropped, so a sorted request falls back to the whole
roster. `ApplySort` with the keys in §2 closes it.

**The summary question from §4 answered itself.** Seat usage comes from `/subscription/entitlements`,
not from counting the array, so paging the list did not break it. What does still need the whole
roster is the permission matrix's employee picker, the team counts, and the rule that the last
administrator cannot be demoted — a page of ten cannot answer any of those. So this screen makes two
reads: one page for the table, one unpaged roster for the rest. That is fine while a roster is
bounded by the plan's seat limit.

If you would rather it were one read, send `activeCount` and `invitedCount` beside `totalItems`, plus
an `adminCount`, and the roster read goes. Not urgent.

### `/admin/plans` — nothing yet

`PlanAdministrationController.GetAsync` is `_plans.GetAllAsync(cancellationToken)`: no paging, no
search, no ordering. The client now sends the full parameter set anyway and applies it to the
collection you return, so the screen already pages and searches — in the browser.

What would make it real, in priority order:

1. **`page` / `pageSize`**, returning `PagedResult`, with absent paging still returning the array —
   the same optional shape as `/groups` and `/employees`.
2. **`search`** over plan **name and tagline**. The tagline matters: it is what tells two similarly
   named plans apart and it is on the card.
3. **`status`** — `active` / `inactive` / `archived`, absent meaning every state. This is the
   screen's own tab and it is already being sent. Bind it as a nullable enum and **do not add an
   `all` member**: absent is how "every state" is said, which is what `/superadmin/admins` does.
4. **`sortBy` / `sortDirection`** — `id`, `name`, `status`, `monthlyPrice`, `yearlyPrice`,
   `sortOrder`, `updatedAt`. Default remains `sortOrder`, which is the order the pricing page uses.
5. **Header counts.** The screen shows "N plans · N active · N promotional" across every plan, not
   this page. While the endpoint returns everything the client computes them for free; the moment it
   pages, they become `—` until the API sends `activeCount` and `promotionalCount` beside
   `totalItems`. Worth including in the same change as (1) so the figures never go blank.

This reverses §3, which listed plans as deliberately unpaged. That was written on the basis that a
platform has a handful of them; the user wants it paged and searched regardless, so it is here.

## 8. One bug, already fixed on the client

`GET /superadmin/admins?status=all` was answering:

```
400  ["The value 'all' is not valid for Status."]
```

Mine: `AdminAccountQuery.Status` is a nullable `TenantAccountStatus` where **absent means every
state**, and the screen was sending its own word for that. It now omits the parameter instead.
Flagged only because the same trap is waiting in `/admin/plans` if `status` gets added there — hence
point (3) above.

---

## 9. Tenants, and the Security index

Two more, both asked for by the user.

### `GET /admin/tenants` — search

Sorting works (`ApplySort` + `SortableTenantColumns`). Search does not: `PageRequest.Search` is
carried and `GetTenantsAsync` never reads it. The screen now has a search box and sends the term.

```csharp
source = source.WhereMatchesTenantSearch(request.Search);   // name, contact email
```

**Unlike `/groups`, there is no client-side fallback here.** That endpoint answers with the whole
collection when no paging is asked for, so the browser can filter it; `/admin/tenants` is always a
`PagedResult`, so an ignored `search` returns page one of everything and nothing can be done about
it here. Until this lands the box is live and the term has no effect.

While there: the **New workspace** and **Export** buttons have been removed from that screen. Both
were rendered with no click handler — provisioning has no endpoint (an Admin account is created from
Customers) and there is no tenant export route. Say if either should exist and I will build the
client half.

### `GET /security/workspaces` — one call instead of eleven

The platform Security index draws one row per workspace with that workspace's people, sessions and
risk counts. There is no endpoint for it, so it is assembled: the admin list, then
`GET /security/overview?tenantId=` **once per row on the page**. Ten workspaces on screen is eleven
requests, and each overview loads every employee and every session of a workspace in order to
produce five numbers.

The list half is now fixed on the client — it reads one page of `/superadmin/admins`, searched and
sorted by the API, instead of every admin account. The fan-out is what is left.

```
GET /security/workspaces?page=1&pageSize=10&search=&sortBy=high&sortDirection=descending
→ 200 { "data": { "items": [
      { "tenantId": "tnt_1", "organisation": "Glow Studio", "admin": "Ayesha Khan",
        "people": 14, "signedIn": 9, "high": 2, "medium": 3, "attention": 4 } ],
    "page": 1, "pageSize": 10, "totalItems": 24, "totalPages": 3 } }
```

Five aggregates per workspace, computed in the database rather than by materialising every session.
`search` over organisation and admin name; sorting by `high`, `attention`, `signedIn` and
`organisation` — **sorting by risk is the point of the screen**, and it is the one thing the current
shape cannot do at all, because the numbers it would sort by arrive after the page has been chosen.
Today the client can only re-order the ten rows it already has, which ranks a page rather than the
platform.

**The fan-out is now gone, ahead of that endpoint.** The index makes exactly one request — one page
of `/superadmin/admins` — and the People / Signed in / Indicators columns and the per-page summary
cards have been removed with it. Opening a workspace still loads its full overview, which is one
request for the one workspace somebody actually asked about.

So the screen currently lists workspaces without their security numbers. That is the honest state
until `/superadmin/security/workspaces` exists; it is not a good screen for security review without
them, and it is the strongest reason to build that endpoint.

Note also: the sort menu has been removed from the index. `/superadmin/admins` ends
`OrderBy(displayName)` whatever `sortBy` says, and asking for a sort the API cannot do made the
client fall back to fetching every account — which is what produced
`GET /superadmin/admins?sortBy=id&sortDirection=ascending` with no paging on it at all. Sorting
comes back with the new endpoint, where it can be done properly, over the whole platform rather than
over ten rows.
