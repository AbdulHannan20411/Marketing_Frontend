# Say Why a Session Ended — Backend Request (small)

## Problem

When someone is suspended, their open browser gets **401 with `X-Session-Revoked: true`** on its next
request. That header is written in two places, and neither says why the session ended:

- `AuthenticationExtensions.cs`, around line 103 (JWT validation)
- `SessionSecurityController.cs`, around line 71 (heartbeat)

So the frontend shows its only message: **"You were signed out because this account signed in on
another device."** For a suspended person that is wrong and confusing. They only learn the truth
when they try to sign in again and get `account_suspended`.

## Request

Next to `X-Session-Revoked: true`, send:

```
X-Session-Revoked-Reason: account_suspended | ended_by_admin | signed_in_elsewhere
```

| Value | When |
| --- | --- |
| `account_suspended` | The session ended because the account was suspended (security screen, Employees screen or Admins screen) |
| `ended_by_admin` | An admin or Super Admin revoked this session from a device list |
| `signed_in_elsewhere` | Displaced by a newer sign-in of the same account; also the fallback |

A password change or reset can use `ended_by_admin`, or add `password_changed` if you'd prefer. The
frontend treats any unknown value as `signed_in_elsewhere`, so adding values later is safe.

**Where the reason comes from:** the session's revocation reason is already recorded. The refresh
token has `RevokedReason`, and `SessionTracker` records `SecurityEventKind.SessionRevoked`. Store a
machine value next to the human text, and have `ISessionTracker.IsActiveAsync` / `TouchAsync`
return it (or make a reason lookup available). Keep it in the same per-session cache, so this adds
no queries.

**CORS:** add `X-Session-Revoked-Reason` to `WithExposedHeaders` in `CorsExtensions.cs`, next to
`SessionRevoked`. Otherwise the browser hides it from the app.

## Frontend (done)

The token interceptor reads the header and shows the matching message on the login page:

| Reason | Message |
| --- | --- |
| `account_suspended` | "This account has been suspended. Contact your workspace admin to have it reactivated." |
| `ended_by_admin` | "You were signed out because an administrator ended this session." |
| anything else or missing | "You were signed out because this account signed in on another device." |

Already handled, no change needed:
- Sign-in and refresh returning `401 account_suspended`: refresh stores the suspended message; the
  login page shows the API's own message.
- The `security.account_suspended` notification.

## Tests

1. Suspend a signed-in employee → their next request gets 401 with `X-Session-Revoked: true` and
   `X-Session-Revoked-Reason: account_suspended`, and the header is readable from the browser.
2. An admin ends one device → `ended_by_admin`.
3. The same account signs in on a second browser → the first gets `signed_in_elsewhere`.
