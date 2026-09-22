# Notification Categories and Per-User Switches — Backend Notes

Answer to `API-NOTIFICATION-CATEGORIES-BACKEND.md`. Both halves are built: `category` on every
notification, and per-user preferences that are honoured **before a row is written**. The
`?category=` filter from §4 is in as well, since it was three lines once the mapping existed.

**Restart the API.** In Development the migration applies itself on startup
(`Database:ApplyMigrationsOnStartup`); elsewhere run `dotnet ef database update`.

---

## 1. `category` on every notification

One new field on `AppNotification`, on the REST responses and the SignalR `notificationReceived`
push alike:

```jsonc
{
  "id": "ntf_12",
  "kind": "inbox.message",
  "category": "messages",     // messages | campaigns | team | billing | security | system
  "title": "New message from Ayesha",
  "…": "…"
}
```

The mapping is `NotificationCategories.Of(kind)` in `Marketing.Common`, not a switch beside `Map`,
because the same answer is needed in three places: the payload you read, the filter applied when a
notification is raised, and the filter applied when the bell is counted. Your table, unchanged —
and an unmapped kind is `system`, so a kind added later is never swallowed by a switch nobody knew
applied to it.

## 2. Preferences

```
GET  /api/v1/notifications/preferences
PUT  /api/v1/notifications/preferences
```

```jsonc
{ "messages": true, "campaigns": false, "team": true, "billing": true, "security": true, "system": true }
```

- Per user, never per workspace. One admin muting campaigns does not mute them for a colleague.
- A user who has never saved anything gets all six `true` — **200, not 404**, exactly as you asked.
- `security` and `system` always come back `true`, and are stored as `true` whatever the body says.
- **PUT is partial**: a missing key keeps what it had. Unknown keys are ignored, so an older client
  sending a category that no longer exists — or a newer one sending a category this build has not
  added yet — still saves the rest.
- **422** carries the offending key when a value is not a boolean, or when the body is not an
  object. Nothing else 422s. (The body is read as raw JSON for this reason: bound to a type, a bad
  value would be a 400 in the framework's wording rather than a 422 in ours.)
- No permission beyond being signed in, like `GET /notifications`.

Storage is `user_notification_preferences (user_id, category, enabled)`, one row per person per
category, unique. **A missing row means enabled**, so nothing is written until somebody actually
turns something off, and a category added later starts on for everyone without a backfill.

## 3. How the switch is honoured

**Before the rows are written.** `INotificationService.WhoWantsAsync(userIds, kind)` narrows the
recipients, and the three places that raise per-user notifications call it first:

| Raiser | Category | Effect |
| --- | --- | --- |
| Inbound customer message | `messages` | a muted employee gets no row and no push |
| Subscription expiry reminder | `billing` | a muted admin gets no row; the email follows the same list |
| Payment submitted (platform reviewers) | `billing` | same |

Security and system pass through untouched, whatever is stored.

**And on the way out**, for the one case the first rule cannot cover: a *tenant-wide* row
(`user_id = null`, which is how a payment approval reaches everyone in a workspace) belongs to no
one person, so it cannot be un-written for one of them. Those rows are filtered when read, in
`GetAsync` and `GetPageAsync` — **including `unreadCount` and `criticalCount`**, which is the part
you rightly flagged as impossible to fix client-side.

So: a suppressed per-user notification is never stored, exactly as you asked. A tenant-wide one is
stored once and is invisible to whoever muted that category, counts included. If you would rather
those were fanned out into per-user rows so the rule is uniform, say so — it is a change of shape,
not of behaviour, and it costs a row per member per notification.

## 4. `?category=` is in

```
GET /notifications?page=1&pageSize=20&category=messages
```

Filters the page and `totalItems`; the two counters keep ignoring page and filters, as before. It
expands the category to its kinds rather than matching a stored column, so rows written before
categories existed are filed correctly too. `category=system` is expressed as an exclusion — it is
the fallback, so it means "everything not mapped elsewhere", which cannot be listed.

## 5. Tests

`NotificationPreferenceTests.cs` and `NotificationCategoryTests` — 26 new, your §5 list in order:

- never-saved → all six true, and nothing written to the table;
- `{"messages": false}` → messages off, the rest untouched, and it survives a read;
- `{"security": false, "system": false}` → both true, and no row left behind that a later change of
  rules might start honouring;
- `{"nonsense": false}` → ignored, the rest saved;
- messages off → no row and no push for that user, colleague unaffected
  (`InboundMessageServiceTests`), and the muted rows do not move `unreadCount`;
- campaigns off → the campaign row is hidden while `security.*` and `meta.*` still arrive;
- every response carries `category`, and an unmapped kind carries `system`;
- two users in one workspace with opposite settings each get exactly what they asked for.

Full unit suite: **656 passing**. API builds clean. The container-backed integration tests were not
run — Docker is not running on this machine.

## 6. One thing to know

`MarkAllReadAsync` marks every notification read, including ones in a category the user has
silenced. They are hidden, not deleted, so this only matters if you later add the "muted" view you
mentioned — the rows would already be read. Say the word if you want that view and I will keep
their read state alone.
