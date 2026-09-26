# View as Employee — Backend Notes

Live. `capabilities.viewAsEmployee` is `true`, so flip the client over.

**Restart the API.** No migration.

---

## 1. The endpoint shape

```
GET /api/v1/inbox/conversations?viewAsEmployeeId=emp_42
```

Any tenant-scoped **GET** (and HEAD). Not a parameter on individual routes — a middleware, so it
applies to every read in the product. Threading an argument through two hundred actions would have
guaranteed that the one that got missed was the interesting one.

`{ "capabilities": { "viewAsEmployee": true } }` is on `GET /auth/me` now, beside `permissions`.

## 2. What it does

The request runs with the teammate's **effective permissions and their identity** — resolved
through `EffectivePermissions.Resolve`, the same function that mints their own token, so the
preview cannot show a different answer from the one they get by signing in. Their roles, their
overrides, their WhatsApp numbers, their assigned conversations.

Your inbox example works because of how the scoping already reads: `GetCallerScopeAsync` returns
*unrestricted* for an Admin and a list of viewable numbers for everyone else. Under a preview the
caller is not an Admin, so it returns the teammate's numbers and the conversation list narrows to
what they would actually see.

## 3. The four refusals

| Case | Answer |
| --- | --- |
| Caller is not an Admin of this workspace | **403** |
| Employee is in another workspace | **404** |
| Employee does not exist, or the id is the wrong kind | **404** |
| Any non-GET carrying the parameter | **400** `view_as_is_read_only` |

The 404-not-403 for another workspace is for the reason you gave about the audit endpoint: a 403
confirms the id names somebody real somewhere.

The write refusal is loud rather than silent. Ignoring the parameter on a `POST` would do the
write as the administrator while the client believed otherwise, which is the same class of wrong
answer the capability flag exists to prevent.

## 4. Three guarantees, and the one you did not ask for

**It can only subtract.** The teammate's permissions are intersected with the caller's own before
the preview is entered. Without that, an administrator previewing a colleague who holds an
override they lack would acquire it for the length of the request — "view as" as a privilege
escalation wearing the clothes of a diagnostic. In practice this changes nothing, since an
administrator holds everything their workspace grants; it is there for when that stops being true.

**Route authorisation still runs against the real caller.** The middleware sits *after*
`UseAuthorization`, so the caller must clear the endpoint's own gate as themselves, and only then
does the preview narrow what that endpoint can see. Same intersecting property as your
`hasPermission`, enforced on the other side.

**Three things never change**, whatever is being previewed: the session the token belongs to, the
account a written row is attributed to, and `/auth/me`. Writes are refused before they reach a
service, so the second should never come up — but "should never" is not a guarantee, and the
failure it would hide is an audit row naming somebody who did not do it.

**Platform staff cannot be previewed**, and a Super Admin who has not scoped themselves to a
workspace with `?adminId=` cannot preview at all. Both should already be impossible via the
workspace check; both are refused explicitly, because the one direction this feature must never
work in is wider.

## 5. Where the record goes — a deviation worth flagging

You asked for an audit entry. I put it on the **workspace's activity feed** rather than in the
formal audit trail:

> Honey · viewed the app as · Ayesha Khan

Two reasons. `AuditLog` is written by the save-changes interceptor and by nothing else — its
repository has no `Add` by design, and this is not an entity change. And `AuditAction` has exactly
three members; adding `viewed` would widen the `action` union on every audit payload your client
already parses, which is a contract change I was not going to make for a side quest.

The activity feed is also the better place for the stated purpose: the person being previewed can
see it. **Say the word if you would rather have it in the audit trail** and I will add
`AuditAction.Viewed` — but that one *is* a client change, so it should be a decision rather than a
surprise.

**Once per entry, as asked** — deduplicated per administrator, per teammate, per session, for 30
minutes, so 200 reads in one sitting produce one entry. It is an in-memory dedupe, so a second API
instance would write a second entry for the same sitting. That is the right way for this to fail:
an audit trail may repeat itself and must not go quiet.

Every request is also logged (EventId **2210**, Information) — the feed carries the readable
summary, the log carries the complete trail for the question the summary cannot answer, which is
not "did they look" but "for how long".

## 6. Excluded routes

`/api/v1/superadmin`, `/api/v1/admin`, `/api/v1/plans`, `/api/v1/auth` — your list. Matched by path
segment, so `/api/v1/administrators` would not be caught by the `/admin` prefix if it ever exists.

The parameter is **ignored** there rather than refused, matching how `?adminId=` treats a caller it
does not apply to. `/auth/` especially must keep answering for the real caller, or the banner would
render using the previewed teammate's profile and lose the way back out.

## 7. Tests

19 new, and most of them are refusals: the administrator role not carried into the preview (the
single most important one — half the codebase asks "is this person an Admin" to decide how wide a
read is); the teammate's own overrides honoured; a preview unable to grant something the caller
lacks; a non-admin refused; another workspace's employee as 404; a wrong-kind id; platform staff
unpreviewable; a Super Admin outside every workspace refused; the scope ending with the request;
the activity entry written once for five reads; and, on the identity itself, that a preview changes
who the caller counts as for reading while never moving the session or the audit attribution.

Full unit suite: **800 passing**. API builds clean, no new warnings.

## 8. One thing left to you

The banner. When `capabilities.viewAsEmployee` is true it can say "Viewing Ayesha's data,
read-only" — and the read-only half is now literally true rather than a convention, because a write
carrying the parameter is a 400 rather than a write.
