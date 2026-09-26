# Created Entries Never Appear in a Record's History

Reported as "created events are not getting logged in History". They **are** being written — the
audit row exists for every create — but it is written against `entity_id = 0`, so no record's
history can ever match it.

## 1. Why

`AuditTrailInterceptor.Capture` runs from `SavingChangesAsync`, before the insert reaches the
database, and writes:

```csharp
EntityId = entry.Entity.Id.ToString(CultureInfo.InvariantCulture),
```

For an `Added` entity with a database-generated key that value is **`0`**. The id is assigned by
PostgreSQL and comes back through `RETURNING id` — which is in the generated SQL for every insert
in today's logs — so at the moment the audit row is built, `Entity.Id` has not been set yet.

Updates and deletes are unaffected: the entity was loaded, so its id is known. That is exactly the
pattern reported — a record's history shows what has been changed since, and never its own
creation.

**One line to confirm it**, before changing anything:

```sql
SELECT entity_name, entity_id, occurred_on
FROM audit_logs
WHERE action = 'Created'
ORDER BY id DESC
LIMIT 10;
```

If those rows read `0`, this is it. The write path is in
`src/Marketing.DataAccess/Interceptors/AuditTrailInterceptor.cs`.

## 2. The fix, and the constraint on it

The change set has to be captured **before** the save (the original values are gone afterwards) but
the id is only known **after** it. So the two halves have to be split for `Added` entities:

- Capture in `SavingChangesAsync` as now, but keep the pending audit rows **and their entity
  entries** rather than adding them to the context immediately.
- In `SavedChangesAsync`, fill in `EntityId` from `entry.Entity.Id` — now assigned — and save the
  audit rows.

The second save must be **in the same transaction** as the first, or a create can be recorded that
did not happen, or happen without being recorded. `AuditTrailInterceptor` already documents that
property for the current single-save path, so this is the part to be careful with: if the existing
save is not already inside an explicit transaction, the audit save has to open one around both.

`Modified` and `Deleted` rows can keep going out with the first save — only `Added` needs the second
pass. That keeps the change small and leaves the paths that work alone.

### Backfilling is not worth it

Every existing `Created` row has `entity_id = 0` and nothing to recover it from: the row does not
say which record it belonged to. Deleting them would be honest housekeeping —
`DELETE FROM audit_logs WHERE action = 'Created' AND entity_id = '0'` — but leaving them costs
nothing either, since no query can match them. Your call; nothing on the client reads them.

## 3. What the client does with it once fixed

Nothing — it already renders `created` entries, and `AUDIT_ACTIONS` has included `created` since the
panel was built. The action chips already offer the filter. So the moment those rows carry a real
id, "Created by Honey · 26-Aug-2026" appears at the bottom of every record's history with no
client change at all.

## 4. While you are in the interceptor

Two things noticed from the same logs, both already written up but worth repeating here because
they are the same file:

- **Contact membership changes** land in the history of `ContactGroupMember` and
  `ContactTagAssignment`, record types with no screen — see
  `API-CONTACT-HISTORY-MEMBERSHIP-BACKEND.md`.
- **Enum values are stored as integers** (`Color: 4 → 3`) where the rest of the API sends names —
  see `API-AUDIT-HISTORY-READABLE-VALUES-BACKEND.md`.

Of the three, this one is the most worth doing: a history that cannot show a record's creation is
missing the entry every investigation starts from.
