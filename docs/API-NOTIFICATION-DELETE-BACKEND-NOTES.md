# Deleting Notifications — Backend Notes

Answer to `API-NOTIFICATION-DELETE-BACKEND.md`. Both endpoints are in, in the shape you specified.
Point the client at the real API.

**Restart the API.** One migration applies on startup in Development.

---

## 1. The two endpoints

```
DELETE /api/v1/notifications/{id}          → 200 { "data": { "deleted": 1 } }
POST   /api/v1/notifications/delete        → 200 { "data": { "deleted": 14 } }
```

```jsonc
{ "ids": ["ntf_9c1", "ntf_9c4"] }   // the ticked rows
{ "scope": "read" }                  // everything already read
{ "scope": "all" }                   // everything
```

**Idempotent, and quiet about it.** `DELETE` answers `200 { "deleted": 0 }` for an id that is
already gone, one that belongs to a colleague, and one that cannot be read at all (`cmp_18`,
`nonsense`) — never a 404 and never a 403. Two tabs deleting the same row is ordinary, and a client
that rolls its optimistic delete back on an error would put the row on screen again for something
that is not a failure. The single answer for all three cases is also the safe one: a refusal that
distinguished "not yours" from "already gone" would confirm that somebody else's id exists.

You said a `404` was workable. `200 { "deleted": 0 }` is what you get, which your handling already
covers.

**`POST`, not `DELETE` with a body** — for exactly the reason you gave, and because
`POST /notifications/read-all` is already the same shape of operation.

**Exactly one of `ids` and `scope`.** Both together, or neither, is a **400** with
`errorCode: "invalid_request"` and `field: "ids"`. That is a 400 rather than this codebase's usual
422 because there is no form field to hang an inline error on — a body like that is a client bug,
not something a person typed.

Three edge cases worth knowing:

- **`{ "ids": [] }` is `200 { "deleted": 0 }`**, not a 400. "Delete these zero rows" is a different
  mistake from sending neither field, and it is not worth failing.
- **Unreadable ids inside a list are skipped**, not fatal. Nine good ones and one stale one clear
  nine.
- **More than 500 ids is a 400** (`too_many_ids`), as you suggested. The `IN` clause is bounded and
  the message points at `scope`.

## 2. What "delete" deletes — the shape question

Your §2 anticipated this correctly, and it turned out to be **both** shapes at once.

Most notifications carry a recipient and are one person's row. Those are **soft-deleted** — the
existing global filter takes them out of every query, so nothing else had to learn about it, and a
support question about a notification somebody swears they never received is still answerable.

But a notification with **no recipient means the whole workspace** — one row that five people read,
which is how a plan change or an expiring subscription is delivered without fanning out a row per
user. Deleting that row would clear it off four colleagues' screens because one of them was
finished with it. So a shared notification is never deleted by a user. A new table,
`notification_dismissals` `(user_id, notification_id)`, records who is finished with it, and the
feed subtracts the caller's dismissals as a correlated `not exists` against a unique index. The row
survives for everybody else.

Tested directly: one person clearing a workspace-wide notification leaves the row intact and the
colleague's feed unchanged.

**The event is untouched, exactly as your confirmation dialog promises.** Clearing "Campaign X
failed" clears the message. The campaign, its delivery report and its audit trail are not touched
by any of this, and nothing in the delete path can reach them.

`scope: "read"` means read by this caller. One caveat on that, which is not new: for a
workspace-wide notification `read` is a single column on the shared row, so marking one read has
always marked it read for the whole workspace. Deleting is now per person; reading still is not.
Worth fixing, but it is a change to the read path, not to this one — say the word and I will move
the read marker into the same per-user place the dismissals live.

## 3. Authorisation

No permission gate, as you said. Ownership is enforced on every one of these — the same scoping the
feed uses, so a caller can only ever delete what they could see. A colleague's id is `deleted: 0`,
never a 403. Tenant scoping comes from the JWT as everywhere else, and platform staff go down the
identical path for their own notifications.

## 4. The things it touches

- **`GET /notifications` no longer returns deleted rows**, and `unreadCount` / `criticalCount` drop
  with them. Both counters are computed server-side over everything addressed to the caller, so
  they were always going to follow; there is a test pinning it.
- **SignalR cannot re-push a deleted notification.** There is no replay: the hub joins groups on
  connect and nothing re-sends a stored row. Pushes happen once, at write time. A reconnect gets
  nothing, so there is nothing for a delete to lose a race with.
- **Read endpoints are unchanged**, and both still return the full list. `read-all` now skips rows
  the caller has dismissed — tested, because a dismissal that held on one route and not another
  would be worse than no dismissal at all.
- **No audit entry**, as you asked — and slightly more than you asked for. Excluding notifications
  from the audit trail had to be per type, so it also stops the entry that was being written every
  time a notification was *created*. That was pure noise: an audit row saying a message about an
  audited event had been written. Nothing reads notification history — it is not a registered
  record type — so no panel loses anything.

**One thing I did not do.** A `scope` delete loads the matching rows and soft-deletes them one by
one, rather than issuing a single bulk update. That keeps the soft-delete and dismissal paths
identical to every other delete in the codebase, at the cost of loading the rows. Fine for a list a
person has actually accumulated; not fine for a hundred thousand. Which is §5.

## 5. Retention

Not built — you said it does not block this, and a job that deletes people's history is worth
agreeing on before it runs rather than after. My answer to your question:

> **Read notifications older than 90 days, and anything at all older than 365 days.**

Ninety days is past any plausible "what was that message about the campaign in March", and a year
is the outer bound where the row is costing more than it could ever be worth. Put that in the
Settings copy. Say yes and it is one Quartz job — no UI, no client change — plus a hard delete of
dismissal rows, which cascade from the notification anyway.

Paging on `GET /notifications` is **already there** from the earlier brief: send `page` or
`pageSize` and you get the `PagedResult` shape with `unreadCount` and `criticalCount`. Switch
whenever you like; the unpaged array is unchanged for clients that have not.

## 6. Tests

17 new in `NotificationDeleteTests`: my own row leaving my list; the same delete twice; an
unreadable id; a colleague's id refused without saying so; a workspace-wide notification cleared
for one person and nobody else; a dismissal not written twice; the ticked rows; nine good ids and
one stale one; `all` and `read` scopes; a scope covering what arrived after the page loaded; a
silenced category *not* swept up by "delete all" (a category switched off for a month should still
have its history when it is switched back on); both-or-neither refused; an empty `ids` array; the
500 cap; the bell counts dropping; and a dismissal surviving `read-all`.

Full unit suite: **706 passing**. API builds clean.

## 7. One line for the client

```
DELETE /api/v1/notifications/{id}
POST   /api/v1/notifications/delete   { "ids": [...] } | { "scope": "all" | "read" }
→ 200 { "data": { "deleted": n } }
```

Migration `AddNotificationDismissals`. Restart the API and it is live.
