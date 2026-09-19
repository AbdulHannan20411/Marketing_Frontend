# Suspend from the Security Screen and No Session Security for Super Admin — Backend Notes

For the frontend agent. The backend now implements the brief. Routes, shapes and error codes are as
specified. The details below are the places where you had a choice.

## Suspend and reactivate

| Route | Success message |
| --- | --- |
| `POST /security/employees/{userId}/suspend` | 200 with the updated row, "Account suspended." |
| `POST /security/employees/{userId}/reactivate` | 200 with the updated row, "Account reactivated." |
| `POST /superadmin/security/tenants/{tenantId}/employees/{userId}/suspend` | Same, and the row includes `risk` |
| `POST /superadmin/security/tenants/{tenantId}/employees/{userId}/reactivate` | Same |

- **Row shape**: every row in both overviews now has `status` (`active`, `invited` or `suspended`) and `canSuspend`.
- **Already in that state**: suspending a suspended account, or reactivating an active one, returns **200 with the current row**. There is no 409.
- **Invited accounts**: reactivate only reactivates a suspended account. An invited account stays invited.
- **Refusal order**: the checks run in this order, so the error is predictable:
  1. yourself → `cannot_suspend_self`;
  2. a Super Admin, on any route → `cannot_suspend_platform_staff`;
  3. an account from another workspace → 404;
  4. on the workspace route, a workspace Admin → `cannot_suspend_admin`.
- **Suspended sign-in**:
  - Signing in or refreshing returns **401 `account_suspended`**: "This account has been suspended. Contact your workspace admin to have it reactivated."
  - The message only appears after a correct password, so it doesn't reveal which addresses exist.
  - Their open sessions get 401 with `X-Session-Revoked: true` on the next request.
- **Notification**: `security.account_suspended` goes to the workspace's admins, with its action pointing to `/settings/security`. It's sent only when a Super Admin suspends someone.
- **Scope**: suspending an Admin from the platform route stops only that person. The organisation stays active.

## Super Admin

| Check | What happens for a Super Admin |
| --- | --- |
| One session per account | Never applied. Signing in never pushes off another of their sessions. |
| Displacement counting, device and location events | Nothing is recorded. |
| New-login and shared-login alerts, failed-login alerts, risk scoring | Nothing is sent or computed. |
| `POST /auth/heartbeat` | Returns 204 and does nothing. |
| Lockout, refresh rotation, `GET /auth/sessions` | Unchanged. Their sessions are still recorded so they can see and end them. |
| Security overview lists | They never appear, even if a data fix left one attached to a workspace. |
