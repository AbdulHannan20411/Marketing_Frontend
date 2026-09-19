# Session Security — Backend Notes

For the frontend agent. Stops one paid seat being shared by many people: one session per account,
device tracking, a heartbeat, device lists with revoke, a risk score for platform staff, and alerts.

All routes under `/api/v1/`, standard `{ data, message, traceId }` envelope.

---

## 1. Required client changes

### Send a device id on every request

Generate a UUID once, keep it in `localStorage`, and send it as **`X-Device-Id`** on every API call
(add it in the existing JWT interceptor). Letters, digits, `-` and `_`, up to 64 characters.

Without it the server falls back to a fingerprint of the user agent, which makes every Chrome on
Windows look like the same device — the device list and the risk score both get worse.

### Heartbeat

`POST /auth/heartbeat` about **every 60 seconds** while the app is open. `204` means fine.

### Handle the new 401

A session can now be ended while the user is using it — by a sign-in elsewhere, or by an admin.
Any request then returns **401 with the header `X-Session-Revoked: true`**.

- **Do not try to refresh.** The refresh token is dead too.
- Sign the user out and say why: *"You were signed out because this account signed in on another
  device."*
- Distinguish it from the existing `X-Token-Expired: true`, which still means "refresh and retry".

The server checks at most every 30 seconds per session, so a displaced tab stops within half a minute.

---

## 2. One session per account

Signing in **ends every other session** of that account. Two people sharing a login keep signing each
other out, which makes sharing useless — and each displacement is recorded as evidence.

Consequence for screens: **"Active sessions" can no longer exceed the number of people.** The number
that shows sharing is **`displacedLast24Hours`** — how often a new sign-in pushed another off.

---

## 3. The user's own devices — "This wasn't me"

| Method | Route | |
| --- | --- | --- |
| `GET` | `/auth/sessions` | This user's devices, current one first |
| `POST` | `/auth/sessions/{sessionId}/revoke` | End one of them |

The new-sign-in email and notification link to **`/account/security`**. Build that page: list the
devices, a **Revoke** button on each, and a prompt to change password. Don't offer revoke on the row
with `isCurrent: true` (that's just signing out).

### Device shape

```jsonc
{
  "sessionId": "ses_41",           // what revoke takes
  "deviceLabel": "Chrome / Windows",
  "browser": "Chrome", "operatingSystem": "Windows", "deviceType": "desktop",   // desktop | mobile | tablet
  "ipAddress": "39.45.12.8",
  "location": "Lahore, PK",        // null when unknown — see §7
  "firstSeenAt": "…", "lastActiveAt": "…",
  "isActive": true,                // seen in the last 5 minutes
  "isCurrent": false,
  "canRevoke": true,
  "signIns": 3
}
```

---

## 4. Workspace admin — Settings → Security

Permission `settings.employees`. **No risk scores here, by design** — an admin sees facts about
their own staff, never a "suspected cheat" label.

| Method | Route |
| --- | --- |
| `GET` | `/security` |
| `GET` | `/security/employees/{employeeId}/devices` |
| `POST` | `/security/sessions/{sessionId}/revoke` |

```jsonc
{
  "organizationId": "tnt_7", "organizationName": "ABC Company", "planName": "Professional",
  "purchasedSeats": 5,             // null = no ceiling
  "usedSeats": 5,
  "activeSessions": 4,
  "uniqueDevices": 9,              // across everyone, last `deviceWindowDays` days
  "deviceWindowDays": 30,
  "employees": [{
    "userId": "emp_12", "name": "Ahmed", "email": "…", "role": "Employee",
    "activeSessions": 1, "devices": 4, "lastActiveAt": "…",
    "displacedLast24Hours": 3,
    "risk": null                   // always null on this endpoint
  }]
}
```

Highlight `devices > 3` and `displacedLast24Hours >= 3` — those are the thresholds the alerts use.

---

## 5. Super Admin — Organization → Security

`SuperAdminOnly`. Same shapes, **with risk**, riskiest people first.

| Method | Route |
| --- | --- |
| `GET` | `/superadmin/security/tenants/{tenantId}` |
| `GET` | `/superadmin/security/tenants/{tenantId}/employees/{employeeId}/devices` |
| `POST` | `/superadmin/security/sessions/{sessionId}/revoke` |

```jsonc
"risk": {
  "level": "high",                 // low | medium | high
  "score": 80,
  "reasons": [
    "3 sign-ins pushed another session off in 24 hours",
    "4 devices in 30 days",
    "2 locations in 7 days",
    "New device in the last 24 hours"
  ]
}
```

Show the reasons, not just the level — they're the evidence, and the answer to a customer who disputes it.

---

## 6. Notifications and email

Two new `NotificationKind` values:

| Kind | To | When |
| --- | --- | --- |
| `security.new_login` | The user | Sign-in from a device they haven't used. Action "This wasn't me" → `/account/security` |
| `security.alert` | Workspace admins | New device, new city, device limit passed, 3 or 10 displacements in a day, 5 failed passwords in 15 min. Action → `/settings/security` |
| `security.alert` | Platform admins | An account turns high risk (once a day at most). Action → `/superadmin/tenants/{id}/security` |

The user also gets an **email** ("New sign-in to your account", template `security.new_login`,
editable in the email template editor) with device, IP, location, time and the same link.

The first-ever sign-in alerts nobody. Alerts fire when a threshold is crossed, not while it stays
crossed, so nobody is notified on every sign-in.

**Correction to the previous handoff:** the auto-reply notification is `ai.replies.exhausted`, not
`aiRepliesExhausted` — every kind uses the dotted form.

---

## 7. Known limits

- **Location needs the edge to provide it.** It's read from Cloudflare's `CF-IPCity`/`CF-IPCountry`
  or `X-Geo-City`/`X-Geo-Country` headers. Running locally there are none, so `location` is `null` —
  show "Unknown location". A GeoIP database would fix this; not built.
- **Not built from the brief:** "concurrent message sending" and "unusual campaign volume" as risk
  signals. They need usage baselines per account; worth adding once there's real data.
- **The limits are config, not per plan:** one session, 3 devices in 30 days, 5 minutes to count as
  active (`Authentication:Policy` in `appsettings.json`).
