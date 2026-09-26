# Failure-Log Export — Follows the Screen's Sort

Done. Delete the four lines.

**Restart the API.** No migration.

---

## The route

```
GET /api/v1/reports/failures/export?sortBy=errorCode&sortDirection=descending
```

Same `sortBy` values as the list — `id` `occurredAt` `campaignName` `contactName` `errorCode`
`phoneNumber` — same `sortDirection`, same `occurredAt desc` default, same `ThenByDescending(id)`
tiebreak. Send the list's request object unchanged and the file matches the table.

## They cannot drift, structurally

Not "kept in step" — the export reads the *same* `SortableFailureColumns` field the paged read
reads. It is one private static dictionary in `AnalyticsService` used by two methods, so a key
added, removed or repointed changes both at once. There is a test that runs the same
`PageRequest` through `GetFailuresAsync` and `StreamFailuresAsync` and asserts the row ids come
out in the same order; it cannot be made to fail without changing what a sort key means for both.

## Three decisions worth stating

**`page` and `pageSize` are accepted and ignored.** The export is still the whole result set, as
you asked. Accepted rather than refused because you said the client sends the list's parameters
unchanged, and a 400 for carrying a harmless `page=2` would be a trap. Documented on the route and
pinned by a test that exports 30 rows with `page=2&pageSize=5` and gets 30.

**An unsortable field is a clean 422**, not a truncated CSV. The query is composed before the
response is touched — `StreamFailuresAsync` is not an iterator method, so `ApplySort` runs and
throws while the response is still unwritten. A test covers it, because the failure mode if I had
got this wrong is a half-written file with an error page stapled to the end, which is the kind of
artefact that gets emailed before anyone notices.

**The default is unchanged.** An export from an unsorted table produces byte-for-byte the file it
produced yesterday.

## Tests

13 new in `FailureExportSortTests`: the export following its sort; the export and the screen
agreeing for the same request; the unsorted default still newest-first; a descending sort; ties
settled so two exports of the same log match row for row; paging ignored; an unsortable field
refused before a row is written; and one per key, because a key the list accepts and the export
refuses would be a 422 nobody could explain.

That last theory is the one I would keep if I could only keep one — the client sending the same
`sortBy` to both is exactly the thing that makes a one-sided allow-list a user-visible bug.

Full unit suite: **781 passing**. API builds clean, no new warnings.

## One thing back to you

The four lines under the "Failure log" heading can go. Nothing else on the Reports screen needs
changing — `sorter.key() !== null` is the right condition and it will simply never be true for
that notice again.
