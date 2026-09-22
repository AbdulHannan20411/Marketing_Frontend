# Record History — Five More Record Types

All five are registered. Enable the buttons.

| `entityName` | Addressed as | Permission | Scope |
| --- | --- | --- | --- |
| `AutoReplySettings` | `current` | `ai.autoreply.manage` | workspace |
| `WhatsAppAccount` | `wa_…` | `whatsapp.connect` | workspace |
| `EmailTemplate` | its key, e.g. `auth.invitation` | `platform.tenants` | platform only |
| `Plan` | `plan_…` | `platform.plans` | platform only |
| `Workspace` | `current` **or** `tnt_…` | `settings.company` | workspace |

Eleven registered types in total, with the six you already have.

---

## The two decisions

**`current`, as you suggested — option (a).** A `SingleRowPerTenant` flag on the registry entry, and
the literal `current` resolves to the workspace's row. It reads better in a URL and a public id for
a row a workspace can only have one of tells nobody anything.

```
GET /api/v1/audit/AutoReplySettings/current
GET /api/v1/audit/Workspace/current
```

**Workspace accepts both.** `current` and `tnt_…` behave identically for a member reading their own
workspace; another workspace's id is a 404. Use whichever suits the call site — `current` needs no
id to hand, the explicit id is clearer in a platform context. Platform staff may pass any `tnt_…`.

One thing to know about `AutoReplySettings`: the settings row is written the first time somebody
saves that screen. A workspace that has never saved one has **no row**, so history is a **404**, not
an empty page. If you would rather show an empty panel there, say so and I will make that one case
return zero entries instead.

**`EmailTemplate` needed nothing from you.** The audit row's `entityId` is the numeric key, but the
registry now carries a `KeyColumn`, so the endpoint resolves `auth.invitation` → row id itself. You
pass exactly what `/superadmin/email-templates/{key}` already uses. Both names — the table's and the
column's — are resolved through the EF model, never formatted from the request.

## One correction worth flagging

`Workspace` is the first registered record whose table has **no `tenant_id` column** — a tenant row
*is* the tenant. The generic existence check is `… where id = @Id and tenant_id = @TenantId`, so it
would have failed against `tenants` with a SQL error rather than a 404. The workspace record now
answers for its own identity instead: `current` is your tenant, an explicit id must match it unless
you are platform staff. `Plan` and `EmailTemplate` avoid the same trap by being `PlatformOnly`,
which takes the cross-tenant path.

## §2 — the ones you offered

I have **not** registered `PaymentRequest`, `PermissionSet` or `Subscription`, and left
`AutoReplyKnowledgeEntry` excluded as you asked. Each is one line whenever you want it. My reading,
for what it is worth:

- **`PermissionSet`** is the one I would add next — a change there changes what a group of employees
  can do, and nothing else records it in those terms.
- **`Subscription`** is worth it if plan changes are ever disputed; the payment trail covers the
  money but not the entitlement.
- **`PaymentRequest`** does look like a duplicate of the review trail. I would leave it until
  somebody asks a question the review trail cannot answer.

Your §3 list — bulk-imported contacts, inbox messages, sessions — I agree with entirely and have
changed nothing there.

## Tests

Five new, in `RecordHistoryTests`: `current` resolving to the workspace's row; a workspace that has
never saved settings being a 404; an email template addressed by key; the workspace record readable
as `current` and as its own id but not as another's; and the WhatsApp number needing
`whatsapp.connect` rather than any WhatsApp permission.

Full unit suite: **685 passing**. API builds clean. No migration — this is registry and resolution
only.
