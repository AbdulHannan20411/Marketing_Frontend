# Notification Categories and Per-User Switches — Backend Requirements

Notifications are now **grouped by what they are about**, and Settings has a switch per group:
turn Messages off and no message notification reaches that user again.

**Frontend status: done.** It infers the group from the kind's prefix, filters what it shows, and
saves the switches to the endpoint below. Two things are needed from the API:

1. **A `category` on each notification** (§2), so the grouping is the server's answer rather than
   the client's guess.
2. **Per-user preferences, and honouring them** (§3) — the important half. Until then a silenced
   notification is still created and pushed; the client hides it, but it is written to the database,
   counts toward the bell on an older client, and would still be emailed.

---

## 1. The groups

| Category | What belongs to it | Kinds today | Can be switched off |
| --- | --- | --- | --- |
| `messages` | Customer replies, conversation assignment | `inbox.*`, `conversation.*` | Yes |
| `campaigns` | A campaign finished, failed or paused | `campaign.*` | Yes |
| `team` | Invitations, permission changes | `employee.*`, `permission.*` | Yes |
| `billing` | Payments, renewals, plan changes, usage limits | `payment.*`, `subscription.*`, `plan.*`, `invoice.*`, `storage.*`, `contacts.*`, `messages.limit` | Yes |
| `security` | New sign-ins, shared-login warnings, suspensions | `security.*`, `session.*` | **No** |
| `system` | WhatsApp connection, expiring tokens, AI allowance, anything else | `meta.*`, `whatsapp.*`, `ai.*`, and **any unrecognised kind** | **No** |

**Why `security` and `system` cannot be silenced:** they are the ones a user least expects — a
stolen sign-in, a broken WhatsApp connection, a spent AI allowance. A switch set months ago should
not be the reason nobody noticed. The frontend does not offer switches for them and forces them on
even if the stored value says otherwise; please do the same server-side.

**An unrecognised kind falls into `system`**, deliberately: a new kind is never silently swallowed
by a switch nobody knew applied to it.

---

## 2. Send the category with each notification

Add one field to the notification payload (`AppNotification` in `WorkspaceDtos.cs`), on both the
REST responses and the SignalR `notificationReceived` push:

```jsonc
{
  "id": "ntf_12",
  "kind": "inbox.message",
  "category": "messages",     // NEW: messages | campaigns | team | billing | security | system
  "title": "New message from Ayesha",
  "...": "..."
}
```

- Map it from the kind, using the table above — one switch statement beside `Map` in
  `NotificationService`.
- **The client does not depend on this yet** (it infers the same thing from the prefix), so it can
  ship whenever. It matters because after that the two sides cannot disagree, and because a new kind
  gets its category from the code that created it rather than from a prefix convention.

---

## 3. Preferences

### `GET /api/v1/notifications/preferences`

Per **user**, not per workspace: one admin muting campaign notifications must not mute them for
their colleague.

**200**

```jsonc
{
  "messages": true,
  "campaigns": false,
  "team": true,
  "billing": true,
  "security": true,
  "system": true
}
```

- **A user who has never changed anything gets everything `true`.** Don't 404 for that — 404 means
  "this API has no preferences", which is exactly how the client reads it (it then leaves every
  switch on and says the feature needs a server update).
- `security` and `system` are always `true` in the response, whatever is stored.

### `PUT /api/v1/notifications/preferences`

Body: the same object. Returns the saved state, in the same shape.

- **Accept a partial object**: a missing key means "leave it as it is" — or treat it as `true`, but
  say which. The client always sends all six.
- **Ignore `security` and `system`** in the request and store them as `true`.
- Ignore unknown keys rather than failing: an older client may send a category that no longer
  exists, and a newer one may send a category you have not added yet.
- **422** only for a body that is not an object of booleans.
- No permission needed beyond being signed in, like `GET /notifications`.

**Storage:** one row per user, e.g. `UserNotificationPreferences(UserId, Category, Enabled)`, or a
small JSON column on the user. A missing row means enabled.

### Honour it when creating a notification

This is the part that makes the switch real. Wherever a notification is raised for a user:

1. Work out its category.
2. If the category is off for that user, **do not create the row and do not push it**.
3. `security` and `system` are always created.

That means a user who muted Messages never sees them again, and they don't count toward
`unreadCount` / `criticalCount` either — which the client cannot fix on its own, because those two
numbers are computed server-side in `GetPageAsync`.

**Where:** in whatever raises them (`INotificationService`), filtering the recipients before the
rows are written, so one muted recipient does not stop the others being notified.

**The same rule applies to any other channel** — email, and push if it arrives later. A muted
category means silence everywhere, not just in the bell.

**Deliberate decision:** a suppressed notification is **not stored** for later reading. The user
asked not to be told, so keeping a hidden copy only creates the question of whether the bell should
count it. If you would rather store and flag it (`suppressed: true`) so it can be shown in a
"muted" view later, that works too — say so and I'll add the view.

---

## 4. While we are here: paging is already built

`GET /notifications?page=&pageSize=&unreadOnly=&priority=` and `NotificationFeed` already exist,
with `unreadCount` and `criticalCount` over everything rather than over the page. **Thank you** —
that was the request in `API-LIST-PAGINATION-BACKEND.md`.

The frontend still fetches the full list and pages it in the browser. I'll switch it to the paged
endpoint, and when I do it would help to have:

- **`category` as a filter** — `?category=messages` — so the page's own grouping tabs can page
  server-side too.
- The same counts you already return.

Neither is needed for the switches; it's the natural next step once §2 and §3 land.

---

## 5. Tests

1. `GET /notifications/preferences` for a user who has never saved → 200, all six `true`.
2. `PUT` with `{"messages": false}` → 200, `messages: false`, everything else unchanged.
3. `PUT` with `{"security": false, "system": false}` → both come back `true`.
4. `PUT` with `{"nonsense": false}` → 200, ignored.
5. With Messages off, a customer replies → **no** notification row for that user, nothing pushed,
   and `unreadCount` does not change. A colleague with Messages on still gets theirs.
6. With Campaigns off, a campaign fails → nothing for that user; the `security.*` and `meta.*`
   kinds still arrive.
7. Every notification response and push carries `category`, and a kind with no mapping carries
   `system`.
8. Two users in one workspace with opposite settings each get exactly what they asked for.
