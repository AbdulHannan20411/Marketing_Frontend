# Record History — Readable Values in `Changes`

History is live and working end to end. Two things in the stored change sets make an entry harder
to read than it needs to be. Both are small, and both are on your side because the client cannot
know what the numbers mean.

## 1. Enum values arrive as numbers

Renaming a tag's colour from `danger` to `info` currently reads:

| Field | Old value | New value |
| --- | --- | --- |
| Color | `4` | `3` |

Nobody can act on that. Everywhere else in the API the same value is a name — `POST /tags` takes
`{"name": "slow", "color": "danger"}` — so the audit trail is the only place it appears as an
integer.

**Ask:** write enum properties into `Changes` as their serialised name, the same string the rest of
the API uses:

```jsonc
"Color": { "old": "danger", "new": "info" }
```

In `AuditTrailInterceptor.BuildChangeSet`, the property's metadata knows its CLR type, so an enum
can be converted where the value is read — one branch beside the redaction check. The global
camelCase enum converter already produces the right strings for the wire; reusing it here keeps the
audit trail and the API's own vocabulary identical.

The client deliberately does **not** guess: it has no way to know that `Color` on a `ContactTag` is
that enum, and inventing a mapping per entity is exactly the per-entity code this feature was built
to avoid.

## 2. Bookkeeping columns are recorded as fields

Every update to a tag currently records three changes:

| Field | Old value | New value |
| --- | --- | --- |
| Color | 4 | 3 |
| Modified by | empty | 16 |
| Modified on | empty | 14/08/2026 16:40 |

The last two repeat the entry's own heading — "**Updated** by Honey · 14-Aug-2026 04:40 PM" — and
`16` is a user id where the heading already has the name. So "3 fields changed" for a change of one.

**The client now hides** `CreatedBy/On`, `ModifiedBy/On`, `UpdatedBy/On`, `DeletedBy/On`,
`IsDeleted`, `RowVersion` and `TenantId`, so entries read correctly today.

**Ask:** skip those columns in `BuildChangeSet` as well. They are already in the row's own
`UserId` and `OccurredOn`, so storing them again costs width in every audit row for information the
row already carries. `IsDeleted` is the one to keep reasoning about: it is not worth recording as a
field, because its meaning is the entry's `Deleted` action — which `ResolveAction` already derives
from it before the change set is built.

Keeping them stored and hidden client-side also works; it is only storage, not correctness. Your
call.

## 3. Optional: three labels

The client humanises property names, which reads well for nearly everything (`FooterText` →
"Footer text"). Three would be better with a `label`:

| Property | Reads as | Better |
| --- | --- | --- |
| `BodyText` | Body text | Message body |
| `HeaderText` | Header text | Header |
| `MaxSearchRadiusKm` | Max search radius km | Search radius (km) |

Sending `label` per change is supported by the client already; everything without one keeps being
humanised. Genuinely optional.

## 4. Not asking for

- **Foreign keys as names** (`WhatsAppAccountId: 3 → 4`). Resolving those means a join per property
  per entry, and the id is at least unambiguous. If a particular one matters — the sending number on
  a campaign, say — it is worth it for that one field alone rather than in general.
- **Old values on a create**, or unchanged fields anywhere. Both correct as they are.
