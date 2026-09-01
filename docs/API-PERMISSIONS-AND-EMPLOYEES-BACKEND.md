# Employees, Entitlements and the Permission Floor — Backend Changes

Three backend changes, all triggered by turning `useMockApi` off. Two of them need a frontend
change; the third needs nothing but is worth knowing.

Read §1 first — it is the one that was breaking every employee's session.

---

## 0. Summary

| # | Change | Frontend action |
| --- | --- | --- |
| 1 | `GET /subscription/entitlements` — new, no permission required | **Switch `entitlement.service.ts` to it** |
| 2 | `/employees/*` and `/permission-sets/*` now exist | None — they were simply 404 before |
| 3 | `dashboard.view` is now a floor every member holds | None |

All three are in the build. Restart the API and they are live. No migration.

---

## 1. `GET /subscription/entitlements` — please switch to this

### The problem it fixes

`shell.component.ts:78` calls `entitlements.load()` for **every signed-in user on every page load**.
That hit `GET /subscription`, which is gated on `settings.subscription` — a permission employees do
not have and should not have.

So every employee got a **403 on every page load**. The service swallowed it
(`error: () => this.loaded.set(true)`), which is why it looked like a permission problem on the
dashboard rather than an entitlements problem: employees ran with entitlements permanently unknown,
and every gated feature fell back to its unknown-state behaviour.

The frontend was doing nothing wrong. The endpoint was carrying two unrelated things behind one
permission.

### The split

```
GET /api/v1/subscription/entitlements    authenticated only  ← what the workspace may do
GET /api/v1/subscription                 settings.subscription ← what the workspace pays
```

The billing endpoint is unchanged. The subscription screen keeps using it and keeps its permission.

### The new response

```jsonc
{
  "planId": "plan_3",
  "planName": "Growth",
  "status": "active",
  "expiresAt": "2026-10-01T00:00:00Z",
  "trialEndsAt": null,
  "modules": { "crm": true, "whatsapp": true, "email": false, "social": false },
  "limits": {
    "maxEmployees": 10,
    "maxContacts": 10000,
    "maxCampaigns": null,
    "maxWhatsAppAccounts": 1,
    "maxEmailAccounts": null,
    "maxSocialAccounts": null,
    "maxApiCallsPerMonth": null,
    "maxStorageMb": 5000,
    "dailyMessageLimit": 1000,
    "monthlyMessageLimit": 50000
  },
  "usage": [
    { "key": "contacts", "label": "Contacts", "used": 1240, "limit": 10000, "unit": "contacts" }
  ]
}
```

`null` in `limits` means **unlimited**, as before.

### What changes in `entitlement.service.ts`

**The shape is flattened by one level.** I told you earlier this would be a one-line change — that
was wrong, and only true of the URL. Sorry. The mapping:

| Today | Now |
| --- | --- |
| `snapshot().subscription.status` | `status` |
| `snapshot().subscription.expiresAt` | `expiresAt` |
| `snapshot().subscription.trialEndsAt` | `trialEndsAt` |
| `snapshot().plan.modules` | `modules` |
| `snapshot().plan.limits` | `limits` |
| `snapshot().plan.name` | `planName` |
| `snapshot().usage` | `usage` — unchanged |

`isLocked()` reads `status` and `expiresAt`, both still present. `hasFeature()` reads `modules`.
`usageFor()` is untouched.

The change is contained to `entitlement.service.ts` and its model. **Nothing else should need to
move** — the `subscription` component keeps calling `GET /subscription` and keeps the full billing
payload.

### What is deliberately not on it

**No `amount`, `currency`, `billingCycle`, `nextRenewalAt` or `autoRenew`.** This endpoint is
readable without a billing permission, so anything priced on it would be disclosed to every employee
in the workspace. Plan list prices are public and appear on your pricing page; what *this* workspace
was charged is not.

There is a test asserting the response type carries none of nine billing field names, so this cannot
regress quietly.

**If the subscription screen needs a number that is missing here, do not add it to this endpoint** —
tell me and it goes on the billing one behind the permission.

---

## 2. `/employees/*` — they exist now

Every route in `EMPLOYEES_API.md` is now served. They were returning 404 because **there was no
controller** — the service layer was complete and registered, but nothing exposed it over HTTP. That
was my omission, and `EMPLOYEES_API.md` described endpoints that had never been wired.

Nothing to change: the routes match the doc exactly, so whatever you built against it should work
as written.

```
GET    /employees                          POST   /employees/invite
PUT    /employees/{id}                     PUT    /employees/{id}/permissions
PUT    /employees/{id}/role                PUT    /employees/{id}/status
POST   /employees/{id}/resend-invite       DELETE /employees/{id}/invite
DELETE /employees/{id}

GET    /permission-sets                    POST   /permission-sets
PUT    /permission-sets/{id}               DELETE /permission-sets/{id}
POST   /permission-sets/{id}/apply
```

All require `settings.employees`. A **403** from these now means the caller lacks that grant — a
different problem from the 404, with a different fix.

### Worth checking on your side

`useMockApi: false` was what exposed this: the mock interceptor implements `/employees/invite` and
the whole employees surface, so the screen worked end to end in the browser and never touched the
API. **Any other screen that only ever ran against the mock will surface the same way.**

If it would help, I can diff the mock interceptor's route list against the API's actual route list
and give you the complete set of what else will 404 — better one list than a series of surprises.

---

## 3. `dashboard.view` is now a floor

Inviting an employee with no permissions ticked used to grant them literally nothing, including the
landing route — so they signed in and the first screen they saw reported a permission error.

`dashboard.view` is now a **floor**: every workspace member holds it regardless of what is granted,
and it cannot be revoked. Deliberately one permission and not a starter pack — the bug before this
one was invitees silently receiving twelve permissions nobody chose.

Two things follow:

- **Employees you have already invited heal themselves.** The floor is applied when permissions are
  resolved, not only when they are written, so existing revoke rows are overridden. They need a
  token refresh — signing out and in is enough. No re-invite, no re-editing.
- **The permissions editor should not offer `dashboard.view` as unticked.** The API will keep
  granting it whatever is sent, so a checkbox that appears to turn it off will not. Either show it
  ticked and disabled, or leave it out of the list. Your call which reads better.

---

## 4. Verified

```
Solution build   0 errors
Unit tests       234 passed, 0 failed
Routes in DLL    employees, permission-sets, entitlements  — confirmed present
```

## 5. Order to do this in

1. **Restart the API** (backend side — I will confirm when done)
2. Switch `entitlement.service.ts` to `/subscription/entitlements` and remap per §1
3. Verify an Employee signs in with no 403s on the dashboard
4. Verify the employees screen against the real API

If anything still 403s, **paste the permission name from the error** — the message names it, and
that string is the entire diagnosis.
