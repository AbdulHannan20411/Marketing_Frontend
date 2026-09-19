# Auto-Reply Permission and Plan-Based Search Radius — Backend Requirements

Two changes. The frontend has both done and they work on the mock API.

1. **Auto-reply now sits in the AI section, under AI Assistant, with its own permission,
   `ai.autoreply.manage`.** Today the endpoints are behind `settings.integrations`.
2. **The business-search radius is limited by the plan.** A new plan limit, `maxSearchRadiusKm`,
   decides the radius dropdown on Contacts → Import → Business search:
   - 5 → options 1, 2, 3, 4, 5
   - 10 → options 1 to 10
   - `null` → options 1 to 10 (no plan ceiling)
   - `0` → no search at all

   The API must enforce it. **The platform maximum is now 10 km, not 50**: no plan and no request
   may go beyond 10 km.

---

## 1. New permission `ai.autoreply.manage`

### Constants (`Permissions.cs`, class `Ai`)

```csharp
/// <summary>Configure AI auto-reply: switch, occasions, timing and the knowledge file.</summary>
public const string AutoReplyManage = "ai.autoreply.manage";
```

Add it to the permission catalogue the Employees screen reads, in the same AI category as
`ai.assistant.use`. Frontend label: **"Manage auto-reply"**. Description: "Turn automatic replies on
or off, choose when they send, and upload what the assistant knows."

- **Admins:** get it automatically, like every other permission.
- **Employees:** don't get it by default. It controls what the business tells customers without a
  person involved, so it should be granted deliberately — the same reasoning as `ai.assistant.use`.
- **Module gate:** `ai`, as now.

### Swap the attribute on every auto-reply endpoint

`AutoReplyController`: replace `[RequirePermission(Permissions.Settings.Integrations)]` with
`[RequirePermission(Permissions.Ai.AutoReplyManage)]` on all five actions:

| Method | Route |
| --- | --- |
| GET | `/api/v1/whatsapp/auto-reply` |
| PUT | `/api/v1/whatsapp/auto-reply` |
| GET | `/api/v1/whatsapp/auto-reply/knowledge` |
| PUT | `/api/v1/whatsapp/auto-reply/knowledge` |
| DELETE | `/api/v1/whatsapp/auto-reply/knowledge` |

**The API routes don't change.** Only the frontend page moved, from `/whatsapp/auto-reply` to
`/ai-assistant/auto-reply`. The old page URL redirects.

### Migration so nobody loses access

Any employee or permission set that has `settings.integrations` today should also be given
`ai.autoreply.manage` in the same migration. Otherwise people who manage auto-reply now would lose
the page. After that, the two permissions are independent.

### Links in emails and notifications

If any notification or email links to the old page `/whatsapp/auto-reply`, change it to
`/ai-assistant/auto-reply`. The old URL still redirects, so this is tidy-up, not urgent.
`ai.replies.exhausted` goes to `/subscription` and doesn't change.

---

## 2. Plan limit `maxSearchRadiusKm`

### Meaning

| Value | Meaning | Dropdown shows |
| --- | --- | --- |
| `1`–`10` | The widest radius allowed, in whole km | `1 … N` |
| `null` | No plan ceiling; the platform's 10 km still applies | `1 … 10` |
| `0` | This plan has no nearby-business search | Disabled: "Not in your plan" + link to plans |

### Where it has to appear

It's a new field in the `limits` object, next to `monthlyAiReplyLimit`, everywhere plan limits are
serialised:

- `GET /subscription/entitlements` → `limits.maxSearchRadiusKm`. **This is the one the dropdown
  reads.**
- `GET /subscription` → `plan.limits.maxSearchRadiusKm`
- `GET /plans`, `GET /admin/plans`, and plan create / patch (`POST /admin/plans`,
  `PATCH /admin/plans/{id}`)

```jsonc
"limits": {
  "maxEmployees": 10,
  "...": "...",
  "monthlyAiReplyLimit": 500,
  "maxSearchRadiusKm": 10        // int | null
}
```

**Entity and migration:** add `int? MaxSearchRadiusKm` on `SubscriptionPlan`. Seed values for
existing plans: Starter 5, Growth 10, Scale 10, Enterprise `null` (= 10). For any other existing plan use 10,
or whatever the business decides.

**Validation on create and patch:** `null` or an integer from 0 to 10. Otherwise 422, keyed
`limits.maxSearchRadiusKm`, with the message "Search radius must be between 0 and 10 km, or
unlimited."

The Super Admin plan editor already has the field: "Business search radius (km)", with an Unlimited
toggle, defaulting to 5 for a new plan.

### Enforce it in the search

In `BusinessDiscoveryService`, **change `MaximumRadiusKm` from 50 to 10**, then next to that check (`ValidateQuery`), for
`POST /business-discovery/search`:

1. Keep the existing checks: `RadiusKm < 1` → 422, and `> 10` → 422 `radius_too_large`, with the message "The search radius cannot be more than 10 km."
2. Load the tenant's current plan limit:
   - `limit == 0` → **403** `radius_exceeds_plan`, detail "Your plan does not include nearby
     business search."
   - `limit != null && RadiusKm > limit` → **403** `radius_exceeds_plan`, detail
     `"Your plan allows searching up to {limit} km."`
3. **Super Admin is exempt**, including "View as". Plan limits never apply to them anywhere else,
   and the frontend offers them 1–10.
4. **Subscription lapsed:** follow whatever the other plan limits do.

```jsonc
// 403
{
  "title": "Radius not in your plan",
  "detail": "Your plan allows searching up to 10 km.",
  "errorCode": "radius_exceeds_plan"
}
```

The frontend shows `detail` as-is. It only sees this error when the plan changed after the page was
opened, because the dropdown never offers more than the limit.

The other business-discovery endpoints (place autocomplete, reverse geocode, categories, import)
don't take a radius and don't change.

---

## 3. Tests

1. An employee with `settings.integrations` but not `ai.autoreply.manage` → 403 on all five
   auto-reply endpoints. With `ai.autoreply.manage` → 200.
2. After the migration, everyone who had `settings.integrations` also has `ai.autoreply.manage`.
3. Admin → has `ai.autoreply.manage`. New employee → doesn't.
4. `GET /subscription/entitlements` includes `limits.maxSearchRadiusKm`.
5. Create a plan with `maxSearchRadiusKm: 11` → 422. With `null` → 200 and saved as null.
6. Starter (5 km): search at 5 → 200, at 6 → 403 `radius_exceeds_plan`.
7. A plan with 0 → any search → 403 `radius_exceeds_plan`.
8. Enterprise (`null`): 10 → 200, 11 → 422 `radius_too_large`.
9. Super Admin viewing as a Starter admin, searching at 10 → 200; at 11 → 422 `radius_too_large`.

---

## 4. Nothing else needed

- **Sidebar, tours, the redirect and the dropdown options** are frontend only.
- **The auto-reply knowledge endpoints** you already built are unchanged apart from the permission
  attribute.
