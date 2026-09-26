> **Resolved.** All six allow-lists are registered, `id` was added to contacts and
> `id`/`batchId` to imports, `asc`/`desc` now bind, and every call site appends a key tiebreak.
> The client sends `sortBy`/`sortDirection` on all eight endpoints and every listed key is a
> control on screen. Kept for the record; §2's open questions are answered in the backend's reply.
> The one item still open is the CSV export in §6 of that reply — see
> `API-REPORTS-EXPORT-SORT-BACKEND.md`.

# List Sorting — Allow-lists for the Endpoints That Page

Every list in the app now has ordering, and the ID and the audit fields each entity actually
carries are on screen. Two lists sort through your API today, because the allow-list already
exists; the rest either sort in the browser (the endpoint returns the whole collection) or **do not
offer sorting at all**, because offering it would be a lie.

This asks for the allow-list on five endpoints. It is the pattern you already have —
`ApplySort` plus a `SortableColumns` dictionary — and nothing else changes.

---

## 1. What already works

| Endpoint | Allow-list | Status |
| --- | --- | --- |
| `GET /contacts` | `fullName`, `status`, `country`, `createdAt`, `lastMessagedAt` | **Wired.** The Contacts table sorts through the API |
| `GET /contacts/imports` | `fileName`, `fileSizeBytes`, `status`, `totalRows`, `failedCount`, `uploadedAt`, `completedAt` | **Wired.** The import history sorts through the API |

One thing to know about what the client sends:

```
?sortBy=createdAt&sortDirection=descending
```

**`descending`, not `desc`.** `SortDirection` is a .NET enum and query-string binding matches the
member name — the camelCase JSON converter only applies to bodies. `desc` does not bind, and an
unbound value is silently the default order, which is the worst kind of wrong: an ascending list
under a header that says descending. If you would rather accept `asc`/`desc` too, a
`TypeConverter` or a small `IModelBinder` on the enum would do it and I will switch the client
over — but as it stands the full word is correct and tested.

## 2. What is asked for

Five endpoints are paged server-side with a fixed `OrderBy` and no allow-list, so the client shows
**plain header labels with no sort control**. Ordering the ten rows in the browser would reorder
the page and say nothing about the other four hundred, which is worse than no sorting.

| Endpoint | Service | Suggested `SortableColumns` |
| --- | --- | --- |
| `GET /campaigns` (if it ever pages) | `AnalyticsService.GetCampaignsAsync` | `name`, `status`, `createdAt`, `createdBy`, `updatedAt`, `audienceSize` |
| `GET /templates` | `WhatsAppService` (~line 209) | `name`, `status`, `category`, `updatedAt`, `timesUsed` |
| `GET /admin/tenants` | `PlatformService` (~line 267) | `name`, `plan`, `status`, `seats`, `messagesThisMonth`, `createdAt` |
| `GET /admin/audit` | `PlatformService` (~line 303) | `occurredAt`, `actor`, `action`, `severity`, `workspace` |
| `GET /payments/review` | `PaymentReviewService` (~line 136) | `submittedAt`, `reviewedAt`, `status`, `amount`, `organisation` |
| `GET /reports/failures` | `AnalyticsService.GetFailuresAsync` | `occurredAt`, `campaignName`, `contactName`, `errorCode` |

Each one is the shape that is already in `ContactService`:

```csharp
private static readonly Dictionary<string, Expression<Func<Tenant, object?>>> SortableColumns =
    new(StringComparer.OrdinalIgnoreCase)
    {
        ["name"] = tenant => tenant.Name,
        ["plan"] = tenant => tenant.Plan,
        ["status"] = tenant => tenant.Status,
        ["seats"] = tenant => tenant.Seats,
        ["createdAt"] = tenant => tenant.CreatedOn,
    };

// then, in place of the fixed OrderBy:
var ordered = source.ApplySort(request, SortableColumns, tenant => tenant.Name);
```

Tell me which keys you register and I will turn each header into a control in the same commit. The
client is built for it — one `sortKey` per column — so it is a few lines per screen, not a rewrite.

### Two small additions to the two that work

- **`id` on `GET /contacts`.** The ID column is on screen and is the one column that cannot be
  sorted. `["id"] = contact => contact.Id` is enough (order by the real key, not the public id
  string, which is derived).
- **`id`/`batchId` on `GET /contacts/imports`**, for the same reason.

## 3. Deliberately not asked for

- **A generic "sort by any property" binder.** The allow-list is the right design: it keeps a
  client-supplied string away from the provider and stops an unindexed column being used to force
  a sequential scan. Please keep it.
- **Sorting on the audit-history panel or the notification feed.** Both are chronological records
  where "newest first" *is* the meaning; they have filters instead, which is the right control for
  them.
- **Stable tiebreaks.** Worth adding if you see paging repeat a row — `ThenBy(x => x.Id)` after the
  chosen sort — but I have not seen it, so it is a note rather than a request.

## 4. What the client does in the meantime

| List | Ordering |
| --- | --- |
| Contacts, Import history | **Server-side**, through your allow-lists |
| Campaigns, Groups, Tags, Employees, Admin accounts, Plans, Invoices | **Client-side**, and complete — these endpoints answer with the whole collection, so the browser sorts everything and then pages it |
| Templates, Tenants, Platform audit, Payments queue, Failure log, Campaign runs | **No sort control**, pending the allow-lists above |

The campaigns list is worth one line of explanation: `GET /campaigns` returns the whole collection
today, so the client sorts and pages it. If it starts paging server-side, the client notices
(`pagedByServer`) and hides its own sort controls rather than reordering one page — so adding
paging there without an allow-list is safe, it just costs the sorting until the allow-list lands.
