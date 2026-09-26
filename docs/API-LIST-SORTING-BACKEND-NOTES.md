# List Sorting — Allow-lists

All five are registered, plus campaign runs and the two small additions. Turn the headers into
controls.

**Restart the API.** No migration.

---

## 1. The keys

| Endpoint | `sortBy` | Default |
| --- | --- | --- |
| `GET /templates` | `id` `name` `status` `category` `updatedAt` `createdAt` `timesUsed` | `updatedAt` desc |
| `GET /admin/tenants` | `id` `name` `plan` `status` `seats` `messagesThisMonth` `createdAt` | `name` |
| `GET /admin/audit` | `occurredAt` `actor` `action` `severity` `workspace` `entity` | `occurredAt` desc |
| `GET /payments/review` | `id` `submittedAt` `reviewedAt` `status` `amount` `organisation` `plan` | `submittedAt` desc |
| `GET /reports/failures` | `id` `occurredAt` `campaignName` `contactName` `errorCode` `phoneNumber` | `occurredAt` desc |
| `GET /campaigns/{id}/runs` | `id` `occurrenceNumber` `scheduledFor` `startedAt` `completedAt` `status` `triggeredManually` | `scheduledFor` desc |

The extras beyond what you listed are free — they were already columns — so take them or leave them.
Campaign runs was on your §4 "pending" list rather than your §2 ask; it is the same one-liner, so it
is done.

**Added to the two that already worked:** `id` on `GET /contacts`, and `id` **and** `batchId` on
`GET /contacts/imports` (same column, both spellings, so nobody has to remember which). Both sort by
the real key, not the `cnt_`/`imp_` string — as text, `cnt_9` sorts after `cnt_10`.

An unknown key is still a **422** naming the allowed values, unchanged.

## 2. `asc` / `desc` now bind

Taken you up on it. `SortDirection` carries a `TypeConverter` accepting `asc`, `desc`, `ascending`,
`descending`, any casing, trimmed. It is `System.ComponentModel`, not MVC, so the innermost layer
picks up no dependency — which was the objection to a binding attribute.

The full word keeps working, so switch the client whenever you like or never.

**The more useful half:** a direction that is *neither* is now a binding failure — a 400 — instead
of silently becoming `Ascending`. That was the failure you described: `descnding` bound to nothing,
nothing is the default, and the list came back in the opposite order to the arrow above it with no
error anywhere. An empty `sortDirection=` is still the default rather than an error, so a client
clearing its sort is fine.

## 3. Stable tiebreaks — I did add them

You filed this as a note rather than a request. I added them anyway, because every allow-list above
contains at least one low-cardinality column and that makes it a correctness problem rather than a
polish one:

- sort 400 templates by `status` and there are four distinct values;
- sort the payment queue by `status` and nearly everything is `pending`;
- sort the failure log by `campaignName` and one bad run supplies a thousand identical values.

`LIMIT/OFFSET` over a sort whose ties PostgreSQL may break differently per execution shows a row on
page one and again on page two, and drops another entirely. On the payments queue that means two
reviewers being handed the same payment while a third is hidden from both.

So `ApplySort` now returns an `IOrderedQueryable`, and every call site appends a key tiebreak. Where
there was already a meaningful secondary sort it is kept and the key goes after it — templates are
still `updatedAt`, then name, then key; runs are still `scheduledFor`, then occurrence number.

## 4. The audit log needed more than a dictionary

Two of your five keys — `actor` and `workspace` — were not columns. `audit_logs` stores `user_id`
and `tenant_id` and has no navigations, and the endpoint was resolving both names *after* the page
was materialised. A name the query does not know cannot be sorted on.

So the read is now a joined query: the actor and the workspace are resolved in SQL, both **left**
joined, because the system identity has no user row and a platform-level entry has no workspace —
an inner join would have silently dropped exactly the entries a reviewer opens this screen to find.

That also fixes something worth knowing about independently: the previous shape read **every user
and every tenant on the platform** into memory on every request, in order to label ten rows.

`severity` is derived, not stored — a deletion is a warning, everything else is information — so it
sorts by the thing it is derived from (`action = deleted`). Ascending puts the routine entries first
and the deletions last, which is what the word implies. The response is byte-for-byte unchanged.

One caveat: sorting by `actor` or `workspace` orders by a joined column with no index behind it. On
a platform-sized audit table that is a sort, not a seek. Fine now; if the screen gets slow, the
answer is an index on `audit_logs (user_id)` rather than withdrawing the key.

## 5. `GET /campaigns` — nothing to do, and nothing lost

It still returns the whole collection, so there is no allow-list to add; a sort key on an unpaged
endpoint would do nothing the browser is not already doing better. Your `pagedByServer` fallback is
the right design, and when that endpoint does start paging I will register
`name` `status` `createdAt` `createdBy` `updatedAt` `audienceSize` in the same commit rather than
after it.

## 6. One thing I left alone, deliberately

The failure-log **export** (`GET /reports/failures/export`) does not take a sort. Its comment
promises it matches the screen's order, and that is now only true of the screen's *default* order —
sort the log by error code and the CSV still comes out newest-first. I have reworded the comment to
say so rather than quietly leaving a false claim, and given the export the same tiebreak so the
default orders match exactly.

If the CSV should follow the on-screen sort, that is a `PageRequest` on the export route and about
four lines. Say the word.

## 7. Agreed, and unchanged

No generic property binder — the allow-list stays. No sorting on the record-history panel or the
notification feed; both are chronological records where "newest first" *is* the meaning, and filters
are the right control.

## 8. Tests

31 new, across `ApplySortTests`, `SortDirectionBindingTests` and `SortableColumnSqlTests`: an
unknown field refused by name; case-insensitive matching; the default fallback; a tiebreak
composing onto the result; both direction spellings, an empty direction, and a typo failing to bind.

Then one per registered key, asserting the query **translates to SQL** against the real PostgreSQL
provider. That last group is the one that earns its place: `updatedAt` is a coalesce, `seats` is a
counted subquery, `severity` is a derived boolean and `actor` lives on a left-joined table — the
kinds of expression that compile in C# and throw at runtime. Two of them are pinned specifically:
`updatedAt` emits `COALESCE` so the column sorts by the value it prints, and `seats` emits a
`count(*)` subquery rather than counting the ten rows on the page.

It caught a real one. The audit projection was a positional record, and EF cannot resolve a member
access back through a constructor call — ordering by `row.OccurredOn` after
`select new AuditEntryRow(...)` did not translate at all. It is an object initialiser now.

Full unit suite: **765 passing**. API builds clean, no new warnings.
