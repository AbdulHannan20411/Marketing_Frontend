# Search Radius Not Saving — Backend Notes

## What the user sees

In Super Admin → Plans, changing **Business search radius (km)** and saving has no effect. The field
comes back empty or unchanged, and the admin's radius dropdown on Contacts → Import → Business search
doesn't follow the plan.

## Cause: the running API is an old build, not missing code

The code is complete and correct:

| Piece | Where | Status |
| --- | --- | --- |
| `int? MaxSearchRadiusKm` on `SubscriptionPlan` | `Billing.cs:120` | Done |
| Migration `20260919071932_AddAutoReplyPermissionAndSearchRadius` | DataAccess | Done |
| `PlanLimits.MaxSearchRadiusKm` in the DTO | `BillingDtos.cs` | Done |
| Returned by `MapPlan`, which feeds `/plans`, `/admin/plans`, `/subscription` and `/subscription/entitlements` | `BillingService.cs:567` | Done |
| Saved on create and patch; 0–10 or null validated | `PlanManagementService.ApplyLimits` | Done |
| Enforced on search, 403 `radius_exceeds_plan`; Super Admin exempt | `BusinessDiscoveryService.EnforcePlanRadiusAsync` | Done |
| Platform ceiling 10 km | `BusinessDiscoveryService.MaximumRadiusKm = 10` | Done |

The API process on the dev machine (`Marketing.API.exe`, PID 3916) started at **06:01**. The radius
migration is from **12:19** and the commit from **12:40**. So the running binary has no
`MaxSearchRadiusKm`:

- **On save:** System.Text.Json quietly ignores the unknown `limits.maxSearchRadiusKm`, so the value
  is never stored.
- **On read:** the responses don't include it, so the client falls back to its default list.

## What to do

1. **Stop** the running API (Visual Studio or PID 3916).
2. **Rebuild** `Marketing.API`.
3. **Start** it again. `WebApplicationExtensions` runs `Database.MigrateAsync()` on startup, which
   applies `AddAutoReplyPermissionAndSearchRadius`: the column, the seed values and the
   `ai.autoreply.manage` grants.
4. **Check:**
   - `GET /api/v1/admin/plans` → each plan's `limits` includes `"maxSearchRadiusKm"`.
   - Save a plan with 3 → it reads back as 3.
   - As that plan's admin, `GET /api/v1/subscription/entitlements` → `limits.maxSearchRadiusKm: 3`.
   - `POST /business-discovery/search` with `radiusKm: 4` → 403 `radius_exceeds_plan`.

The same restart also activates `ai.autoreply.manage`. Until then, **Auto-reply is missing from the
sidebar**, because the old API doesn't grant that permission.

## One small request (optional)

`GooglePlacesProvider.MaximumRadiusKm` is still **50** (`GooglePlacesProvider.cs:38`). The service
already rejects anything over 10 before it reaches the provider, so nothing is wrong today. Setting it
to 10, or reading the service's constant, keeps the two from drifting apart.

## What the frontend changed so this can't be silent again

- **After saving a plan,** if the server's copy doesn't hold the radius that was sent, a warning
  says so: "The server does not store this limit yet. Restart the API with its latest update…".
- **A 422 on plan save** now shows the server's own message, for example "Search radius must be
  between 0 and 10 km…", instead of a generic failure.
- **The radius field in the plan editor** can't go past 10.
- **Business search re-reads the entitlements when it opens,** so a plan change applies without the
  admin signing out and back in.
