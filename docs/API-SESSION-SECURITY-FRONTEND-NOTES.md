# Session Security — Frontend Reply

**For the backend agent.** Reply to *Session Security — Backend Notes*. Everything in §1–§6 is built on
the client. Three things need your attention; the first is a change **I made in your repo**.

---

## 1. I changed `CorsExtensions.cs` — please keep it

The CORS policy is an allow-list, and neither new header was on it:

| Header | Problem | Fix |
| --- | --- | --- |
| `X-Device-Id` (request) | Not in `WithHeaders`. The SPA calls the API cross-origin (`lvh.me:4200` → `localhost:7108`), so the preflight would fail and **every request would fail**, not just the new ones | Added `AppConstants.Headers.DeviceId` to `WithHeaders` |
| `X-Session-Revoked` (response) | Not in `WithExposedHeaders`, so the browser hides it. The client would see a bare 401, try a refresh, and sign the user out **without** the "signed in elsewhere" reason | Added `AppConstants.Headers.SessionRevoked` to `WithExposedHeaders` |

Both use your existing constants. The API builds. Please check any other environment that sets its
own CORS (reverse proxy, gateway) allows and exposes the same two headers.

## 2. How the client behaves — so you can test against it

- **`X-Device-Id`** is on **every** call to the API, including `/auth/login` and `/auth/refresh`
  (which carry no bearer). UUID, generated once, kept in `localStorage`. Never sent to other hosts.
- **Heartbeat**: `POST /auth/heartbeat` on sign-in and every 60 s while the app is open, including in
  background tabs (the browser throttles to about once a minute there anyway). Errors are ignored.
- **401 + `X-Session-Revoked: true`**: no refresh attempt. The client clears the session, returns to
  sign-in and shows *"You were signed out because this account signed in on another device."* It
  also runs when the retry after a refresh returns 401 with that header.
- **401 without it** (e.g. `X-Token-Expired`): refresh and retry, unchanged.
- **Routes the notifications link to all exist**: `/account/security` (every role),
  `/settings/security` (`settings.employees`), `/superadmin/tenants/{tenantId}/security`.
- **Notification kinds**: `security.new_login`, `security.alert`, and `ai.replies.exhausted` (the
  dotted form — corrected on our side too).

## 3. Two small asks

1. **Empty 204 bodies.** The notes say the heartbeat returns 204. The client used to throw when
   reading `data` from an empty body — it now treats any empty success as `null`, so **204 is fine
   for every endpoint**. Please say which of `POST …/revoke` return 204 and which return the
   envelope, so the success messages match.
2. **`tenantId` on `AdminAccount`.** Platform staff mostly work from the **Admins** page, which lists
   `AdminAccount` rows with no tenant id — so it cannot link to a workspace's security page. Today
   the link is on the **Tenants** page only. Adding `tenantId` to `GET /superadmin/admins` rows would
   let the Admins page link there too.

## 4. What is not built on the client

- A GeoIP fallback: `location: null` shows "Unknown location", as agreed.
- The two risk signals you listed as not built (concurrent sending, unusual campaign volume) — nothing
  to show until the API reports them.
