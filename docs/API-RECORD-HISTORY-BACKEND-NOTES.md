# Record History (Audit) — Backend Notes

Answer to `API-RECORD-HISTORY-BACKEND.md`. The endpoint, the registry, the user names and the index
are all in, plus the two §4 items. Nothing was declined.

**Restart the API.** Two migrations apply on startup in Development.

---

## 1. `GET /api/v1/audit/{entityName}/{entityId}`

```
GET /api/v1/audit/Template/tpl_18?page=1&pageSize=10&action=updated&userId=emp_4
                                  &from=2026-09-01&to=2026-09-22
```

The standard `PagedResult`, newest first, in the shape you specified — `action` lowercase (the
global enum converter already does that), `occurredAt` in UTC, `userId`/`userName` null for a
background job, and `changes` passed through **exactly as stored**. Nothing is filled in on the way
out: only the fields that moved appear, a create carries no `old`, and a redacted field is
`{ "redacted": true }`.

`?adminId=` works as it does everywhere else, so "view as" needs nothing new.

**Defaults and caps:** page 10, ceiling **50** rather than the platform's usual 100. A change set is
unbounded in width — a create carries every column of the record — so fifty entries can be a much
larger response than fifty of anything else.

`label` per change is **not** implemented, so the client keeps humanising property names. Say which
fields read badly and I will add labels for those rather than for all of them.

## 2. The registry

[`AuditableEntities.cs`](../../BackEnd/Marketing_backend/src/Marketing.Application/Services/Audit/AuditableEntities.cs),
as you wrote it. Six entries today: Template, Employee, Contact, Campaign, Group, Tag. Adding a
seventh is one line — the interceptor already audits every `BaseEntity`.

An unregistered name is a **404**, as asked: a typo in a client template should be loud.

## 3. Authorisation

In your order, and the order is deliberate — an unknown name must not reveal whether the permission
you lack exists, and a permission failure must not confirm a record's id:

1. not signed in → **401**
2. name not in the registry → **404**
3. id does not parse with that prefix → **404** (not 422: `cnt_18` asked for as a `Template` is the
   same mistake as a record that is not there, and "invalid id" would advertise the prefix scheme)
4. missing the registry's permission → **403**
5. **the record itself is loaded**, tenant-scoped, and a miss is **404**
6. only then are the audit rows read

Step 5 is a `select 1 from <table> where id = @Id and tenant_id = @TenantId` through the existing
SQL reader, which refuses any statement that does not name `@TenantId` — so the tenant predicate
cannot be forgotten. The table name comes from the EF model, never from the request.

Two things worth knowing:

- **Soft-deleted records still have a readable history.** The existence check does not filter
  `is_deleted`, because the delete itself is the entry people come looking for; filtering it out
  would make the last thing that happened the one thing nobody could read.
- **Platform staff without `?adminId=`** read across workspaces (they are outside every one, and a
  tenant-scoped check has no tenant to be scoped to). With `?adminId=` it is an ordinary scoped
  read.

## 4. userName

Joined per page from the distinct actor ids, with `IgnoreQueryFilters` so **someone who has left
still has their name on what they did**. The system identity (`UserId = 1`) returns `userId: null`
and `userName: null`, so the client shows "Automatic".

## 5. The two §4 items

**Hard deletes are now audited.** `Capture` only looked at `Added` and `Modified`; a true
`EntityState.Deleted` — a join row cleared in bulk, anything that skips the soft-delete rewrite —
left no trace at all. It now records `Deleted` with the old values and no new ones. (The soft-delete
interceptor runs first, so an ordinary delete still arrives as the `IsDeleted` update it always was.)

**A create still records every column**, which is right for history and is why the page cap is 50.
The redaction list already covers the big ones — email bodies, hashes, Meta tokens, the registration
PIN. If a create's width becomes a problem, the cheapest fix is redacting by size rather than by
name; say the word.

**Action casing** needed no change: `AuditAction` goes through the global camelCase enum converter,
so it was already `created` / `updated` / `deleted` on the wire.

## 6. Index

```
ix_audit_logs_entity_name_entity_id_occurred_on  (entity_name, entity_id, occurred_on DESC)
```

Replaces the old two-column index — every query this endpoint makes is that shape, and time
descending as the third key means page one is the front of the index rather than a sort of every
entry a long-lived record has collected. Migration `AddRecordHistoryIndex`.

## 7. Tests

22 new, all passing (full unit suite: **680**).

`AuditTrailInterceptorTests` — create records what was set and who set it, in UTC; an update records
the two fields that moved and not the eighteen that did not; an entity saved with no changes writes
no row at all; soft delete and hard delete each record a `Deleted`; a password change is recorded
with `{ "redacted": true }` and the hash appears nowhere in the row; an excluded entity leaves no
trail; an unauthenticated change is attributed to the platform.

`RecordHistoryTests` and `AuditableEntityRegistryTests` — newest first with names resolved; another
record's history not mixed in; a background job's entry with no name; a departed colleague keeping
theirs; each filter narrowing `totalItems` as well as the page; the closing day of a range included
whole; the page cap; unknown type, mismatched id, missing permission and another workspace's record
each refused the right way; platform staff reading across workspaces.

**Not covered here:** the rollback case from your §5. It needs a real transaction, so it belongs in
the container-backed integration suite, and Docker is not running on this machine. The behaviour
follows from where the rows are written — the interceptor adds them to the same `DbContext` before
`SaveChanges`, so they are in the caller's transaction and a rollback takes them with it — but I
have not proved it here, and I would rather say so than imply I had.

## 8. Enabling history for another record

Exactly as you described. One line in the registry:

```csharp
new("Department", nameof(Department), PublicId.Department, Permissions.Settings.Company),
```

and the tag on your side. Excluding a field is one entry in `RedactedProperties`; excluding a whole
entity is one in `ExcludedTypes`.
