# Two Small Asks: Platform Search, and Contact Audit Fields

Both are shipped around on the client — this is the part that needs you, and both are additive.

## 1. `GET /search` cannot answer a platform question

The global search box (Ctrl-K) calls `GET /search?q=`, which resolves a tenant from the caller. An
unscoped Super Admin has no tenant, so it could only ever answer nothing — and the palette spun
"Searching…" forever because of a client bug on top of it (fixed: an error inside the stream killed
the pipeline, so one failure meant no search ever ran again).

**Shipped now:** for platform staff outside a workspace the palette searches **customers** instead,
filtering `GET /superadmin/admins` by organisation, admin name and email in the browser. The quick
links change to platform ones too — admin accounts, payment requests, security, plans. Scoped to an
admin through the scope bar, the ordinary workspace search is used, which is correct.

**The ask, when it is worth it:** one endpoint so this stops being a client-side filter over the
whole admin list.

```
GET /api/v1/superadmin/search?q=metro
→ 200 { "data": [ { "kind": "workspace" | "plan" | "payment",
                    "label": "Workspaces",
                    "results": [ { "id", "title", "subtitle", "route" } ] } ] }
```

Same `SearchResultGroup` shape the tenant search already returns, so the palette renders it with no
new code. Workspaces are the half that matters; plans and payment requests are worth including
because they are the other two things platform staff hunt for by name.

**Not urgent.** Filtering the admin list works and the list is small. It becomes urgent at a few
hundred customers, when fetching every admin account to answer a keystroke stops being reasonable.

## 2. A contact's audit fields

The contacts table now shows **ID, Name, Phone, Country, Groups, Tags, Status, Last messaged,
Created** — and Created is the only audit column, because `ContactResponse` carries `createdAt` and
nothing else. The request was for created-by and modified-by/at as well.

**Ask:** add to `ContactResponse` what the entity already stores:

```jsonc
{ "createdAt": "...", "createdBy": "Honey", "updatedAt": "...", "updatedBy": "Ayesha Khan" }
```

`BaseEntity` has `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`, so the values exist; the
"by" pair needs the same user-name join the audit endpoint does for its `userName`. If that join is
not worth it per row on a paged list, send the ids and I will show them — but names are what the
column is for, and an id in a "Modified by" column is the thing the record-history brief already
asked you to stop doing.

**Null is expected and handled.** A contact that has never been edited renders an em dash; a
contact imported by the system shows whatever `createdBy` holds. The client adds the two columns as
soon as the fields appear, hidden below `md` like the other secondary columns.

One note on ordering: `updatedAt` and `createdBy` would want `SortableColumns` entries on
`GET /contacts` to be sortable. Same one-liner as the rest of that allow-list — no rush, and the
columns are useful unsorted.
