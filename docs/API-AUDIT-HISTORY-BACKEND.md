# Record History (Audit) — Backend Requirements

Every important record gets a **History** option: created / updated / deleted, by whom, when, and
**only the fields that changed**, old value beside new.

**Most of this already exists on your side.** `AuditLog` and `AuditTrailInterceptor` already record
exactly the right thing. What's missing is one endpoint, a name→entity registry, and user names.

**Frontend status: done.** `<app-history-button entityName="Template" [entityId]="…">` and
`<app-audit-history …>` are built, wired into the Templates page, and working against the mock API.
They read the endpoint in §3.

---

## 1. What you already have (no changes needed)

| Piece | Where | Status |
| --- | --- | --- |
| `AuditLog` entity: `Id`, `TenantId`, `UserId`, `EntityName`, `EntityId`, `Action`, `Changes` (jsonb), `CorrelationId`, `IpAddress`, `OccurredOn` | `DataAccess/Entities/AuditLog.cs` | Matches the brief |
| A `SaveChanges` interceptor writing a row per change **in the same transaction**, so a rollback takes the audit row with it | `DataAccess/Interceptors/AuditTrailInterceptor.cs` | Done |
| **Only modified properties** for an update; every set property for a create | `BuildChangeSet` | Done |
| Soft deletes recorded as `Deleted` (the auditing interceptor rewrites a hard delete into `IsDeleted`) | `ResolveAction` | Done |
| Sensitive fields recorded as `{ "redacted": true }` — password and token hashes, Meta tokens, the registration PIN, email bodies | `RedactedProperties` | Done |
| Entity types excluded entirely — `RefreshToken`, `AutoReplyKnowledgeEntry`, `AutoReplyAttempt` | `ExcludedTypes` | Done |
| Actor from claims, UTC clock, correlation id, IP | `ICurrentUser`, `IDateTimeProvider`, `IRequestContext` | Done |

`Changes` is stored as `{ "Name": { "old": "A", "new": "B" } }`. **Keep that.** The client reads
both that map and a projected list, so nothing has to change together.

---

## 2. The registry: public names → entities (the reusable part)

The client asks by a **public name**, not a CLR type: `Template`, `Employee`, `Contact`. That name
is also what decides authorisation. One registry is what makes this feature reusable — after it,
switching history on for a new entity is one entry, not new code.

```csharp
// Marketing.Application/Services/Audit/AuditableEntities.cs
public sealed record AuditableEntity(
    string PublicName,          // what the client sends: "Template"
    string EntityName,          // what AuditLog.EntityName holds: "MessageTemplate"
    string IdPrefix,            // the public id prefix: PublicId.Template
    string? Permission,         // permission needed to read the record, null = any signed-in user
    bool PlatformOnly = false); // Super Admin only, e.g. plans and tenants

public static class AuditableEntities
{
    private static readonly AuditableEntity[] All =
    [
        new("Template",  nameof(MessageTemplate), PublicId.Template, Permissions.WhatsApp.Templates.View),
        new("Employee",  nameof(User),            PublicId.Employee, Permissions.Settings.Employees),
        new("Contact",   nameof(Contact),         PublicId.Contact,  Permissions.Contacts.View),
        new("Campaign",  nameof(Campaign),        PublicId.Campaign, Permissions.WhatsApp.Campaigns.Reports),
        new("Group",     nameof(ContactGroup),    PublicId.Group,    Permissions.Groups.Manage),
        new("Tag",       nameof(ContactTag),      PublicId.Tag,      Permissions.Tags.Manage),
        // Add a line to enable history for another entity. Nothing else changes.
    ];

    public static AuditableEntity? Find(string publicName) =>
        All.FirstOrDefault(entry => string.Equals(entry.PublicName, publicName, StringComparison.OrdinalIgnoreCase));
}
```

**A name that isn't in the registry is a 404**, not an empty list — a typo in a client template
should be loud, not look like "no history".

---

## 3. `GET /api/v1/audit/{entityName}/{entityId}`

```
GET /api/v1/audit/Template/tpl_18?page=1&pageSize=10&action=updated&userId=emp_4
                                  &from=2026-09-01&to=2026-09-22
```

| Parameter | Meaning |
| --- | --- |
| `page`, `pageSize` | Default 1 and 10; cap the size at 50 |
| `action` | `created`, `updated`, `deleted`. Omitted = all |
| `userId` | Public id of the person who made the change (`emp_…` / `usr_…`) |
| `from`, `to` | `yyyy-MM-dd`, **inclusive**, in the workspace's timezone; `to` covers the whole day |

**200** — the standard `PagedResult`, newest first:

```jsonc
{
  "items": [
    {
      "id": "aud_10432",
      "entityName": "Template",
      "entityId": "tpl_18",
      "action": "updated",                       // lowercase
      "userId": "emp_4",                         // null for a background job
      "userName": "John Rivera",                 // null for a background job
      "occurredAt": "2026-09-22T11:45:00Z",      // UTC
      "changes": {
        "Name":   { "old": "Template A", "new": "Template B" },
        "Status": { "old": "Draft",      "new": "Published" },
        "HtmlBody": { "redacted": true }
      }
    },
    {
      "id": "aud_10001",
      "action": "created",
      "userId": "usr_1",
      "userName": "Ayesha Khan",
      "occurredAt": "2026-09-22T10:30:00Z",
      "changes": { "Name": { "new": "Template A" } }   // no "old" on a create
    }
  ],
  "page": 1, "pageSize": 10, "totalItems": 2, "totalPages": 1
}
```

Optional niceties the client already supports:
- **`label` per change** (`"label": "Message body"`). Without it the client humanises the property
  name (`BodyText` → "Body text"), which is fine for most fields but not for the few whose column
  name reads badly.
- **A projected list** instead of the map: `[{ "property": "Name", "oldValue": …, "newValue": … }]`.
  Either shape works; the map is less work for you.

### Only changed fields

Nothing extra to do — the interceptor already stores only modified properties. Please **don't**
"fill in" unchanged fields when projecting for this endpoint.

### `userName`

`AuditLog` stores `UserId` only, so join it: `AuditLogs.Join(Users, …)` projecting `DisplayName`, or
a single `Users.Where(u => ids.Contains(u.Id))` lookup for the page's distinct ids. A deleted user
should still resolve (the row is soft-deleted, so `IgnoreQueryFilters`) — history that says "by ?"
after someone leaves is worse than useless. A system change (`UserId` = the system identity) →
`userId: null`, `userName: null`; the client shows "Automatic".

### Authorisation (the important part)

**In this order:**

1. Signed in, else 401.
2. The name is in the registry, else **404**.
3. Parse `{entityId}` with the registry's prefix, else 404.
4. **The caller can read the underlying record**, else **403**:
   - the registry's `Permission`, via the existing `[RequirePermission]` / permission service;
   - **and the record is in the caller's tenant** — load the row (`IgnoreQueryFilters` off, so the
     tenant filter applies) and 404 if it isn't there. Do this even though `AuditLog.TenantId`
     exists: an audit row's tenant is not proof that *this* record belongs to the caller.
   - `PlatformOnly` entries: Super Admin only.
5. Only then read `AuditLogs` for `EntityName` + the numeric `EntityId`.

**Never** authorise on the audit table alone. "Can read the record" is the whole rule, exactly as
asked: no history for a record the user cannot see.

Super Admin using "View as" is already tenant-scoped by `?adminId=`, so it works unchanged.

### Index

```sql
CREATE INDEX IX_AuditLogs_Entity_OccurredOn
    ON "AuditLogs" ("EntityName", "EntityId", "OccurredOn" DESC);
```

Every query this endpoint makes is that shape. Add it in the migration with the endpoint.

---

## 4. Also worth doing (small)

1. **Record deletes of rows that aren't soft-deleted.** `Capture` only looks at `Added` and
   `Modified`; a true `EntityState.Deleted` (any entity not going through the soft-delete rewrite)
   is currently not audited. Add `Deleted`, recording the old values as
   `{ "Field": { "old": … } }`.
2. **`Changes` of an audited create is every column.** That is right for history, but it means a
   create row carries the entity's whole state. Worth confirming that's intended for big text
   columns; the redaction list already covers email bodies.
3. **`AuditAction` on the wire.** The client lowercases whatever arrives, so `Created`/`created`
   both work — but sending lowercase keeps it consistent with the rest of the API's enums.

---

## 5. Tests

1. **Create:** create a template → one `Created` row, `UserId` = the caller, `OccurredOn` in UTC,
   `Changes` holding the fields that were set.
2. **Update, only changed fields:** change 2 of ~20 properties → `Changes` has exactly those 2, each
   with `old` and `new`.
3. **Unchanged fields:** save an entity with no modifications → **no audit row at all**.
4. **Delete:** delete a template → one `Deleted` row.
5. **Rollback:** throw after `SaveChangesAsync` inside a transaction that is then rolled back →
   neither the change nor its audit row exists. And: a failing `SaveChanges` writes no audit row.
6. **Redaction:** change a user's password → the row exists, `PasswordHash` is
   `{ "redacted": true }`, and the hash appears nowhere in the audit table.
7. **Excluded entity:** save a `RefreshToken` → no audit row.
8. **Endpoint:** `GET /audit/Template/{id}` → newest first, paged, with `userName` resolved.
9. **Filters:** `action=updated`, `userId=`, `from`/`to` each narrow the result, and `totalItems`
   describes the filtered set.
10. **Authorisation:** an employee without the template permission → 403. A template from another
    workspace → 404. An unknown `entityName` → 404. Unauthenticated → 401.
11. **System change:** a background job updates a record → `userId: null`, `userName: null`.

---

## 6. Enabling history for another entity

Once §2 and §3 exist, for `Department`, `Project`, `Document`, `Settings` or anything else:

**Backend — one line:**

```csharp
new("Department", nameof(Department), PublicId.Department, Permissions.Settings.Company),
```

The interceptor already audits it, because it audits every `BaseEntity`. Exclude a field with one
entry in `RedactedProperties`, or a whole entity with one in `ExcludedTypes`.

**Frontend — one tag:**

```html
<app-history-button entityName="Department" [entityId]="department.id" [recordName]="department.name" />
```

or, for a details page or a tab:

```html
<app-audit-history entityName="Department" [entityId]="department.id" recordLabel="Department" />
```

No new model, service or component per entity: the fields, their wording and their values all come
from the API.
