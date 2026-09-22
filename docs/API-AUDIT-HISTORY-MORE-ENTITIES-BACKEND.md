# Record History — Five More Record Types

The history endpoint and registry are in and working; thank you. History buttons are now placed
across the app, and the six registered types work today:

| Record | Where the button is |
| --- | --- |
| Template | Templates → each card |
| Contact | Contacts → each row |
| Group | Groups → each card |
| Tag | Tags → each card |
| Campaign | Campaigns → each row |
| Employee | Employees → each row |

**This asks for five more registry lines.** The buttons for them are already placed and
**hidden**: the client keeps its own copy of your registry (`AUDIT_ENTITIES` in
`audit-history.model.ts`) and hides a button for a name the API does not know, so nobody sees a
control that answers "not available". Each line you add, I add the matching name and the button
appears.

---

## 1. The five

| Public name | Entity | Suggested permission | Why it matters |
| --- | --- | --- | --- |
| `AutoReplySettings` | the auto-reply settings row | `ai.autoreply.manage` | It decides what the business says to customers unattended. "Who turned this on, and when?" is the first question after a bad automatic reply |
| `WhatsAppAccount` | `WhatsAppConnection` / the account row | `whatsapp.connect` | Numbers get renamed, made default, disconnected and removed. Access changes per employee live here too |
| `EmailTemplate` | `EmailTemplate` | `platform.tenants` (Super Admin) | Platform-wide: one edit changes the mail every workspace receives. Bodies are already redacted, which is right — who and when is the point |
| `Plan` | `SubscriptionPlan` | `platform.plans` | Prices, limits and modules. A customer disputing a limit is answered by this |
| `Workspace` | `Tenant` | `settings.company` | Company profile, timezone and the workspace-wide settings |

```csharp
new("AutoReplySettings", nameof(AutoReplySettings),  PublicId.?,               Permissions.Ai.AutoReplyManage),
new("WhatsAppAccount",   nameof(WhatsAppConnection), PublicId.WhatsAppAccount, Permissions.WhatsApp.Connect),
new("EmailTemplate",     nameof(EmailTemplate),      PublicId.EmailTemplate,   Permissions.Platform.Tenants, PlatformOnly: true),
new("Plan",              nameof(SubscriptionPlan),   PublicId.Plan,            Permissions.Platform.Plans,   PlatformOnly: true),
new("Workspace",         nameof(Tenant),             PublicId.Tenant,          Permissions.Settings.Company),
```

### Two that need a decision

**`AutoReplySettings` has no public id.** There is one settings row per workspace, and the client
asks for it as:

```
GET /api/v1/audit/AutoReplySettings/current
```

`current` meaning "this workspace's row". Options, your call:

- **(a)** accept the literal `current` for single-row-per-tenant types and resolve it to the
  tenant's row — a `SingleRowPerTenant` flag on the registry entry;
- **(b)** give the settings row a public id (`ars_…`) and return it on
  `GET /whatsapp/auto-reply`, and I'll pass that instead.

(a) is less work for both of us and reads better in a URL. Same question applies to `Workspace`,
where the client can equally pass the tenant's own id — say which you prefer and I'll match it.

**`EmailTemplate` is keyed by name, not a number.** The client passes the key it already uses
(`invitation`, `password_reset`). If `EntityId` in the audit row is the numeric key, map the public
key to it in the registry lookup; if the table is keyed by that string, nothing to do.

---

## 2. Anything else worth registering

Lower value, but cheap once the pattern is there — tell me if you add any and I'll place the button:

- **`PaymentRequest`** — who approved or rejected a manual payment, and when. The review itself is
  already recorded elsewhere, so this may be duplicate.
- **`PermissionSet`** — a change to a permission set changes what a group of employees can do.
- **`Subscription`** — plan changes and renewals for one workspace.
- **`AutoReplyKnowledgeEntry`** — currently in `ExcludedTypes`, deliberately: entries are replaced
  in bulk and the content is the customer's own words. **Leave it excluded.** The one useful fact —
  that somebody replaced the file, and how many rows — is already recorded as its own audit event.

## 3. Not worth it

- **Contacts imported in bulk.** A 5,000-row import would write 5,000 audit rows. The import batch
  already records who and when; per-contact history for imported rows is noise at a cost.
- **Inbox messages.** They are the record of what happened; they don't change.
- **Sessions and refresh tokens.** Already excluded, and the security screens cover them.

## 4. What I need from you, in one line

Add the five registry lines (and answer the `current` question for the two single-row types). Reply
with the names you registered and I'll enable each button in the same commit.
