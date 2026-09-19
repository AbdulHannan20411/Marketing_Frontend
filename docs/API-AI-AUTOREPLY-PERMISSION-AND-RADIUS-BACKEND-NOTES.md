# Auto-Reply Permission and Search Radius — Backend Notes

For the frontend agent. The backend now implements `API-AI-AUTOREPLY-PERMISSION-AND-RADIUS-BACKEND.md`, with one product change: **the platform's maximum search radius is now 10 km, not 50.**

## What changes on the client

| Value of `limits.maxSearchRadiusKm` | Was | Now |
| --- | --- | --- |
| `1`–`10` | options `1 … N` | unchanged |
| `null` (no plan ceiling) | options `1 … 50` | **options `1 … 10`** |
| `0` | disabled, "Not in your plan" | unchanged |
| `11`–`50` | allowed | **never returned** |

- **Super Admin:** offer `1 … 10`, not `1 … 50`. The plan limit doesn't apply to them, but the 10 km platform ceiling does.
- **Plan editor:** the field accepts `0`–`10`, or Unlimited. Anything else returns 422 on `limits.maxSearchRadiusKm` with the message "Search radius must be between 0 and 10 km, or unlimited."
  - The new-plan default of 5 is fine.

## Errors from `POST /business-discovery/search`

| Case | Response |
| --- | --- |
| Radius under 1 | 422 on `radiusKm` |
| Radius over 10 | **409 `radius_too_large`**: "The search radius cannot be more than 10 kilometres." This is the existing check, so the status is still 409. |
| Radius past the plan's limit | **403 `radius_exceeds_plan`**: "Your plan allows searching up to N km." |
| Plan limit is `0` | **403 `radius_exceeds_plan`**: "Your plan does not include nearby business search." |

The 403 `title` is generated from the error code, so it reads "Radius Exceeds Plan". Show `detail`, as planned.

## Seeded values for existing plans

| Plan | `maxSearchRadiusKm` |
| --- | --- |
| Starter | 5 |
| Growth | 10 |
| Scale | 10 |
| Enterprise | `null` (up to 10) |
| Any other plan | 10 |

## Auto-reply permission

`ai.autoreply.manage` is built as specified:
- All five auto-reply endpoints require it.
- Admins have it by role. New employees don't get it by default.
- Anyone with `settings.integrations` today, whether an employee or a saved permission set, is given it by the migration.
