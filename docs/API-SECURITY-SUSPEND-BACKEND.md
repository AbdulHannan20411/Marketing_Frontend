# Suspend From the Security Screen, and No Security Checks on Super Admin — Backend Requirements

Two things:

1. **Suspending an account from the security screen**, so an admin or employee flagged by the
   security checks can be stopped straight away.
2. **Session security for Admins and Employees only, never Super Admin.** That covers
   one-session-per-account, device tracking, displacement counting, risk scoring, alerts and the
   heartbeat.

The frontend is done and works on the mock API.

---

## 1. How the screen behaves (for context)

**Where:**

| Screen | Viewer | Can suspend |
| --- | --- | --- |
| Settings → Security | Workspace Admin | Employees of their own workspace |
| Platform → Security → a workspace | Super Admin | That workspace's Admin and Employees |

**The alert level comes from what the security checks say:**

| Level | Platform view (has `risk`) | Workspace view (`risk` is always null) |
| --- | --- | --- |
| `low` | `risk.level = low` | No threshold crossed |
| `warning` | `risk.level = medium` | More than 3 devices, or 3+ displacements in 24 h |
| `high` | `risk.level = high` | — |

**What pressing Suspend does:**

- **`low`:** a dialog asks "Do you really want to suspend…?", with an optional reason.
- **`warning` or `high`:** it suspends immediately, with no dialog. The button reads
  "Suspend now" and is shown in red.
- **Afterwards:** the row shows a "Suspended" badge and a **Reactivate** button, which acts
  immediately.

**Never offered for:** Super Admin rows, the viewer's own row, and, from a workspace, that
workspace's Admin.

---

## 2. New endpoints

All return the person's updated row: the `EmployeeSecurityResponse` shape, plus the two new fields
below.

| Method | Route | Who |
| --- | --- | --- |
| POST | `/api/v1/security/employees/{userId}/suspend` | Workspace Admin (`settings.employees`) |
| POST | `/api/v1/security/employees/{userId}/reactivate` | Workspace Admin (`settings.employees`) |
| POST | `/api/v1/superadmin/security/tenants/{tenantId}/employees/{userId}/suspend` | Super Admin |
| POST | `/api/v1/superadmin/security/tenants/{tenantId}/employees/{userId}/reactivate` | Super Admin |

`{userId}` is the id the overview already returns (`emp_…`). `{tenantId}` is `tnt_…`.

### Suspend request

```jsonc
{
  "reason": "Login shared with a second person",   // string | null, ≤ 500 chars, optional
  "alertLevel": "warning"                            // "low" | "warning" | "high"
}
```

- **`alertLevel`** is what the screen showed when the button was pressed. **Record it in the audit
  log; don't trust it for anything else.** The server should recompute the risk itself.
- **`reason`:** plain text, trimmed; empty becomes null.

### Response: 200, the updated row

```jsonc
{
  "userId": "emp_12",
  "name": "Sara Khan",
  "email": "sara@nextreach.io",
  "role": "Employee",
  "activeSessions": 0,
  "devices": 3,
  "lastActiveAt": "2026-09-19T09:40:00Z",
  "displacedLast24Hours": 2,
  "risk": { "level": "medium", "score": 45, "reasons": ["…"] },   // null on the workspace route
  "status": "suspended",       // NEW
  "canSuspend": true           // NEW
}
```

### What suspending must do, in one transaction

1. Set `User.Status = Suspended`, using the same status the Employees screen and Admins screen use,
   so every screen agrees.
2. **Revoke every refresh token and tracked session of that user.** Their next API call or heartbeat
   (within about 60 s) then gets **401 with `X-Session-Revoked: true`**, and the client signs them
   out. This is the same mechanism as a revoked session.
3. **Sign-in is refused** while suspended. `EnsureAccountUsable` already does this, so check that it
   also covers the refresh-token path. Its message should say the account is suspended and to
   contact the workspace admin.
4. **Audit:** `security.account.suspended`, with actor, target, `alertLevel`, the server's own risk
   level and score at that moment, and `reason`. Reactivate writes `security.account.reactivated`.
5. **Notify** the target's workspace admins when a Super Admin suspends someone, including the
   admin themself. New `NotificationKind` `security.account_suspended`, pointing to
   `/settings/security`.

**Suspending an Admin (Super Admin only)** blocks that admin's sign-in. **The organisation itself
stays active**: employees keep working. That is different from the existing
`/superadmin/admins/{id}/status`, which suspends the admin **and the organisation**. Keep both; they
answer different problems.

**Reactivate:** `Status = Active`, audit, and nothing else. Sessions don't come back; the person
signs in again.

### Refusals

| Status | `errorCode` | When |
| --- | --- | --- |
| 403 | `cannot_suspend_self` | The target is the caller |
| 403 | `cannot_suspend_admin` | Workspace route and the target is that workspace's Admin |
| 403 | `cannot_suspend_platform_staff` | The target is a Super Admin, on any route |
| 404 | — | The user isn't in that workspace (the workspace route is tenant-scoped, as the overview is) |
| 409 | `already_suspended` / `not_suspended` | Optional; returning 200 with the current row also works |

The frontend shows `title` and `detail`, so write them for a person to read.

### Two new fields on every row of both overviews

```jsonc
"status": "active" | "invited" | "suspended",
"canSuspend": boolean     // false for self, platform staff, and (workspace route) the workspace admin
```

`canSuspend` lets the server be the authority. Without it the client applies the same rules, which
is fine but duplicated.

---

## 3. No security checks on Super Admin

Right now sign-in runs `EnforceSessionLimitAsync` and `_sessions.StartAsync` / `AnnounceAsync` for
every user (`AuthenticationService`, around lines 145–157), **including platform administrators**.
Make all of it apply to Admins and Employees only:

| Check | Change for Super Admin (`User.TenantId == null`) |
| --- | --- |
| One session per account (`EnforceSessionLimitAsync`) | **Skip.** Signing in never displaces another Super Admin session |
| Session and device tracking (`SessionTracker.StartAsync`) | **Skip**, or at least no displacement counting |
| New-device / shared-login alerts (`AnnounceAsync`, `SecurityAlertService`) | **Skip** |
| Risk scoring (`AccountRisk`) | Never computed |
| `POST /auth/heartbeat` | Return 204 and do nothing; the client no longer sends it for Super Admins |
| Security overview lists | Never include them. Already true, since they have no `TenantId`; keep it that way |
| Suspend endpoints | Refuse, `cannot_suspend_platform_staff` |

**What stays the same for Super Admin:** normal authentication, lockout after failed passwords,
refresh-token rotation, and "your devices" (`GET /auth/sessions`), where they can still see and sign
out their own sessions.

**Frontend side, done:**
- The heartbeat doesn't run for a Super Admin.
- Super Admin rows are filtered out of the security lists if any appear.
- Suspend is never offered on them.

---

## 4. Tests

1. An admin suspends an employee at `low` → 200, `status: suspended`, all their sessions revoked;
   the employee's next heartbeat → 401 `X-Session-Revoked`.
2. The suspended employee signs in → refused with the "suspended" message; refresh → refused.
3. Reactivate → 200, `status: active`; they can sign in.
4. An admin suspends themself → 403 `cannot_suspend_self`.
5. An admin suspends another Admin of their workspace from `/security/...` → 403
   `cannot_suspend_admin`.
6. A Super Admin suspends a workspace's Admin from the platform route → 200. That admin's employees
   can still sign in, and the organisation is still active.
7. Any route targeting a Super Admin → 403 `cannot_suspend_platform_staff`.
8. An admin of workspace A suspends a user of workspace B → 404.
9. The audit entry has `alertLevel`, the server's risk level and score, and the reason.
10. A Super Admin signs in on two browsers → both stay signed in; no displacement is recorded; no
    alert is sent.
11. An employee signs in on two browsers → the first is displaced, exactly as today.
