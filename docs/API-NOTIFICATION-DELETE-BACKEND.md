# Deleting Notifications — Backend Notes

Reading a notification is not the same as being done with it. The list only ever grew: marking
everything read left the same hundred rows on screen, and the page became something people stopped
opening. The client now has delete — one row, the ticked rows, or the lot — and needs two endpoints.

The UI is built and shipped behind these. Until they exist, a delete fails, the rows come back and
a toast says so.

---

## 1. The two endpoints

### Delete one

```
DELETE /api/v1/notifications/{id}
→ 200 { "data": { "deleted": 1 } }
```

**Make it idempotent.** Deleting the same notification twice is ordinary, not an error: the bell and
the Notification Center are both on screen, and people have two tabs open. `200 { "deleted": 0 }`
for an id that is already gone is the honest answer.

A `404` is handled too — the client treats it as "already gone" and does **not** put the row back —
so either is workable. `404` for a notification belonging to *another user* is right and important;
see §3.

### Delete many

```
POST /api/v1/notifications/delete
{ "ids": ["ntf_9c1", "ntf_9c4"] }        // the ticked rows
{ "scope": "read" }                       // everything already read
{ "scope": "all" }                        // everything
→ 200 { "data": { "deleted": 14 } }
```

Exactly one of `ids` and `scope`; both, or neither, is `400`.

**Why POST and not `DELETE` with a body.** A body on `DELETE` is allowed but unreliable in practice —
proxies and some HTTP stacks drop it, and it is unspecified enough that it will eventually be dropped
somewhere between the browser and Kestrel. The app already uses `POST /notifications/read-all` for
the same shape of operation, so this matches what is there.

**Why `scope` and not a list of ids for "delete all".** The client only knows about the rows it
holds. A notification raised thirty seconds ago, or one that never reached this tab, would be left
behind — and the person who clicked "Delete all" would see it reappear. `scope` is evaluated
server-side, over everything the user has.

`deleted` is used for the confirmation toast ("14 notifications deleted"). The client has already
removed the rows, so it is wording, not state — a count that is slightly higher than the user
expected (rows the client never held) is fine and in fact more truthful.

### Suggested shape

```csharp
[HttpDelete("{id}")]
public async Task<IActionResult> Delete(string id, CancellationToken ct);

public sealed record DeleteNotificationsRequest(
    IReadOnlyList<string>? Ids,
    NotificationDeleteScope? Scope);   // All, Read

[HttpPost("delete")]
public async Task<IActionResult> DeleteMany(DeleteNotificationsRequest request, CancellationToken ct);
```

Cap `ids` at something sane — 500 is more than any screen can select — and `400` above it rather
than building an `IN` clause of unbounded size.

---

## 2. What "delete" deletes

**A notification is deleted for the user who deleted it, and for nobody else.** This is the one
part worth being careful about, and it depends on how the rows are stored:

- **One row per recipient** (each user has their own row, which is what the read flag suggests) —
  delete the row. Nothing else to think about.
- **One row per tenant with a per-user read marker** — a delete must *not* remove the row. It has
  to be recorded in the same per-user place the read state lives (`DeletedAt`, or a
  `NotificationRecipient.IsDeleted` flag) and filtered out of `GET /notifications`. An admin
  clearing their own list must never clear their colleagues'.

Either way, the event a notification refers to is untouched. Deleting "Campaign X failed" deletes
the message about the campaign, not the campaign, not its delivery report, not the audit trail. The
confirmation dialog says exactly that, so it needs to be true.

**`scope: "read"` means read by this user**, which under the per-tenant shape is the same per-user
marker again.

---

## 3. Authorisation

No permission gate: these are the caller's own notifications. The only rule is ownership —
`WHERE UserId = <caller>` on every one of these, so an id belonging to someone else is a `404` and
never a `403` (a `403` confirms the id exists, which is its own small leak).

Tenant scoping comes from the JWT as everywhere else. Platform staff acting on their own
notifications go down exactly the same path.

---

## 4. Things it touches

- **`GET /notifications`** must not return deleted rows, and the unread count derived from it drops
  accordingly. Nothing on the client caches around this.
- **SignalR** must not re-push a deleted notification. If a resend can happen — a retry, a
  reconnect replay — the delete has to win, or the row walks back in and the delete looks broken.
- **Read endpoints are unchanged.** `POST /notifications/{id}/read` and `/read-all` return the full
  list as they do now.
- **No audit entry.** These are one person's own messages, not a business record; auditing them adds
  rows nobody will ever read. (If you disagree because of the platform-admin case, a single
  `NotificationsCleared` event with a count would be enough — not one row per notification.)

---

## 5. While you are in there — retention

Deleting by hand fixes the symptom. The list still grows without limit for anyone who never clears
it, and `GET /notifications` is still unpaged — the standing ask in
`API-LIST-PAGINATION-BACKEND.md`. Worth considering, in this order:

1. **A purge job**: delete read notifications older than 90 days, and anything older than a year.
   One job, no UI, and it keeps the table from becoming the biggest one in the database.
2. **Paging** on `GET /notifications`, which the client is ready to switch to.

Neither blocks this. Say the word on the purge window and I will put it in the Settings copy so
people know their history is not kept forever.

---

## 6. What I need, in one line

`DELETE /api/v1/notifications/{id}` and `POST /api/v1/notifications/delete` taking `ids` **or**
`scope`, both returning `{ "deleted": n }`, both scoped to the caller. Tell me when they are in and
I will point the client at the real API.
