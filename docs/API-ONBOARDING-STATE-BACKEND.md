# Onboarding State — Backend Response

Answer to `API-ONBOARDING-STATE.md`. Both endpoints are built, exactly to the shape specified.

Base path: `/api/v1/auth`.

---

## 0. Status

| Method | Path | State |
| --- | --- | --- |
| GET | `/auth/me/onboarding` | **Built** |
| PUT | `/auth/me/onboarding` | **Built** |

**One caveat:** the migration adding the columns has not been applied yet — the API process is
holding the build output on this machine. Until it runs, both endpoints will fail. **Ask before
flipping `useApi` to `true`**; I will tell you the moment it lands. Nothing about the shape changes.

---

## 1. The shape — as specified

```jsonc
{
  "status": "in_progress",              // not_started | in_progress | completed | skipped
  "stepIndex": 2,
  "updatedAt": "2026-08-21T08:24:02.993Z"
}
```

**`GET` never 404s.** A user nobody has stored anything for comes back `not_started` at step `0`
with `updatedAt: null`. That is the column default rather than a special case, so first sign-in
needs no branch on either side.

**`PUT` takes the same shape and returns the stored result.** Idempotent, last write wins.

Two details worth knowing:

- **`updatedAt` on the way in is ignored.** You said it need not be trusted; it is not read at all,
  and the response carries the server's own clock. Keep sending it or drop it — either works.
- **A negative `stepIndex` is clamped to 0, not refused.** The server cannot validate the upper
  bound — the step list is derived from the user's own navigation, so only you know the length — and
  refusing the write would throw away the `status` alongside the bad index.

---

## 2. Scoping — as specified

Resolved entirely from the JWT. No id in the route or the body, and the endpoints will not accept
one. Per user, not per tenant. No permission beyond being authenticated, so employees and admins use
the identical endpoints.

---

## 3. Storage, in case it matters later

Three columns on the user rather than a table of its own: it is a one-to-one relationship whose
fields are always read and written together, so a separate table would add a join to every read and
a does-a-row-exist branch to every write.

This has one consequence you may care about: **the state survives as long as the account does**.
There is no separate lifecycle to expire or clean up, and "restart the tour" is a normal write
rather than a delete.

---

## 4. Your §5 note about Settings — checked, and you are fine

You un-gated the Settings nav item on the grounds that the route never had a guard. I checked what
that exposes server-side, because a nav item was never the real protection.

**`settings.company` gates no endpoint on the API.** It is defined in the permission catalogue and
referenced by nothing — there is no company-settings endpoint for it to protect yet.

Everything reachable from the Settings page is gated by its own distinct permission and enforced at
the API, not by the sidebar:

- Subscription reads and writes → `settings.subscription`
- Billing, invoices, payment methods → `settings.billing`
- Profile and tour → authenticated only, correctly

So an employee who reaches Settings by typing the URL sees the personal parts and gets a 403 from
anything else. Your change brought the sidebar in line with what the route already allowed; it did
not open anything.

**Your closing point is the right rule** and worth keeping: if genuinely company-level content is
added later, gate it *inside* the page — and I will gate the endpoint behind it server-side. Hiding
a nav entry is a tidiness measure, never a security boundary.

---

## 5. Verified

```
Solution build   0 errors
Unit tests       195 passed, 0 failed   (3 new on these endpoints)
```

Covering: a user with no stored state reads as `not_started` at step 0 rather than 404; progress is
stored and stamped with the server's clock, not the caller's; a negative index is clamped while the
status is still saved.

---

## 6. What to change

Nothing, until I confirm the migration is applied. Then flip `useApi` in
`core/services/onboarding-store.service.ts` and delete the `localStorage` path if you want to —
though leaving it as a fallback for an offline first-run is defensible, your call.
