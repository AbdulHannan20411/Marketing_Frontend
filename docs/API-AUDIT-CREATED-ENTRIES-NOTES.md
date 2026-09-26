# Created Entries in Record History — Fixed

Your diagnosis was exact. Confirmed, fixed, and verified against the real database.

**Restart the API.** No migration.

---

## 1. Confirmed

Your query, run against the dev database:

```
action=Created  zero_id=true   count=977
action=Updated  zero_id=false  count=1995
action=Deleted  zero_id=false  count=142
```

**977 create entries, every one at `entity_id = 0`.** Not one update or delete affected — exactly
the pattern you described, and for exactly the reason you gave.

## 2. The fix, and where it differs from your plan

You proposed holding the `Added` rows back and writing them in `SavedChanges`. I did something
slightly different, because your plan has a failure mode worth avoiding.

**The audit row still goes out with the first save**, in the same transaction as the change, as an
update's always has. Only the *identifier* is corrected afterwards: it is written as the literal
`"pending"`, and `SavedChanges` replaces it with the key the database has just assigned.

The difference is what happens if the second statement fails:

| | your plan | this |
| --- | --- | --- |
| second save fails | the create happened with **nothing recorded** | an entry exists, not linked |

This keeps the guarantee the file is built on — a change and its audit row commit together or not
at all — and degrades to today's behaviour rather than to silence. `"pending"` is also
deliberately not a number: `0` was a well-formed id that simply matched no record, which is why
977 of them sat there looking like data.

**On the transaction.** You were right that it is not already inside an explicit one — the common
path is a bare `SaveChangesAsync`, so EF's implicit transaction commits before `SavedChanges` runs.
I did not open one around both, and deliberately: retries are enabled on the Npgsql provider, so
`BeginTransaction` outside an execution strategy throws, which is the trap `ExecuteInTransactionAsync`
exists to document. Given that, keeping the row itself atomic and letting only the link be a second
statement is the strongest position available.

`Modified` and `Deleted` are untouched, as you said. A failed save clears the pending list, so a
rolled-back create cannot be linked and saved by whatever the caller tries next.

## 3. Verified end to end, not inferred

Unit tests cannot cover the second save, so I ran the real interceptors against the real database:

```
inserted contact id = 44
latest Contact audit rows:
   action=Created entity_id=44  at=26/09/2026 1:27:29 pm   ← after
   action=Created entity_id=0   at=26/09/2026 1:16:44 pm   ← before
   action=Created entity_id=0   at=26/09/2026 11:49:36 am  ← before
```

The probe contact was deleted afterwards; nothing else in your database was touched.

## 4. The old rows

Agreed on both counts — nothing can recover them and nothing can match them. I have **not** deleted
them; that is your call and the statement is in your brief. One thing in favour of running it: the
record-history panel's `totalItems` counts rows it then cannot show for the record, so leaving 977
of them is harmless but not quite free.

## 5. Your §4

- **Enum values as integers is already fixed** — that shipped with the readable-values work.
  `"Color": { "old": "danger", "new": "info" }` on anything written since. Rows written before it
  still read `4`, as noted there.
- **Membership history on `ContactGroupMember` / `ContactTagAssignment`** is still open. I have not
  seen `API-CONTACT-HISTORY-MEMBERSHIP-BACKEND.md` — send it and I will pick it up.

## 6. Tests

3 new in `AuditTrailInterceptorTests`: a create's row carrying `"pending"` before the save and the
real key after it; an update linked straight away and needing no second pass; and a failed save
leaving nothing waiting to be linked.

Full unit suite: **823 passing**. API builds clean, no new warnings.

## 7. Nothing for you

As you said — `AUDIT_ACTIONS` already has `created`, the chips already offer the filter. Restart
the API and "Created by Honey · 26-Aug-2026" appears at the bottom of every record's history from
the next create onward.
