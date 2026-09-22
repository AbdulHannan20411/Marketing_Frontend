# Record History — Readable Values

All three done. No migration; restart the API.

---

## 1. Enums are written as names

```jsonc
"Color": { "old": "danger", "new": "info" }
```

Done by giving the change set the API's own enum converter rather than converting per property, so
the audit trail and the API share one vocabulary by construction: types that pin their own spelling
— the payment enums' PascalCase, the notification kinds' dotted names — keep it here too, which
`ToString()` would have quietly broken.

**Old rows keep their numbers.** Nothing rewrites history, so an entry written before this build
still reads `4`. Worth leaving whatever the client does with a numeric value in place for a while.

## 2. Bookkeeping columns are no longer recorded

`CreatedBy/On`, `ModifiedBy/On`, `DeletedBy/On`, `IsDeleted`, `RowVersion` and `TenantId` are
skipped when the change set is built — not stored and hidden, but not stored. Storage is the lesser
reason; the better one is that a change set is the answer to "what changed", and those columns
answered "something changed", which the entry already says.

Two consequences worth knowing:

- **Keep your client-side hiding.** Rows written before this build still carry them.
- **A soft delete's change set is now `{}`.** Every column it touched was bookkeeping. The entry is
  still written — its meaning is the `deleted` action, not a field list — so a delete entry now
  arrives with no fields at all. If the panel currently renders "0 fields changed" for that, it is
  worth special-casing to just the heading.

`UpdatedBy/On` do not exist on `BaseEntity` in this codebase — the columns are `ModifiedBy/On`, and
those are the ones skipped.

## 3. The three labels

```jsonc
"BodyText": { "label": "Message body", "old": "…", "new": "…" }
```

`BodyText` → "Message body", `HeaderText` → "Header", `MaxSearchRadiusKm` → "Search radius (km)".
Everything else arrives without a label and is yours to humanise.

Applied when history is **read**, not when it is written: a label is presentation, and storing it in
every row would freeze today's wording into rows nobody can edit. Changing one, or adding a fourth,
is a line in `AuditFieldLabels` and takes effect for every entry ever written, including old ones.

Values are untouched beside it — a redaction still arrives as `{ "redacted": true }` and nothing
else.

## One thing I got wrong last time

Adding hard-delete auditing, I keyed "report the whole row" on the *action*. A soft delete is a
`Deleted` action on an EF-*modified* row, so with §2 in place it would have started dumping every
column of the record into the change set — the opposite of what you asked for. It is keyed on the
entry's state now: created and hard-deleted rows report every column, anything arriving as a
modification reports only what moved. Covered by a test.

## Tests

Four new: an enum recorded as its name; bookkeeping columns absent from an ordinary update; a soft
delete surviving with an empty change set; and a label added on read without disturbing the values
or a redaction. Full unit suite: **689 passing**, API builds clean.

## §4

Agreed and unchanged — foreign keys stay as ids, creates keep their new-only values, unchanged
fields stay absent. If one particular foreign key is worth resolving (the sending number on a
campaign was your example), say which and I will do that field rather than the general case.
