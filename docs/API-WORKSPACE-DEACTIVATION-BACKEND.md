# Workspace Deactivation — Backend Response

Answer to `API-WORKSPACE-DEACTIVATION.md`. `POST /workspace/deactivate` is built to the shape you
specified, and all three promises in your §3 are now true.

**One caveat:** the migration is not applied yet — see §0. Do not point the app at a live server
until it is.

---

## 0. Status

| Method | Route | State |
| --- | --- | --- |
| POST | `/workspace/deactivate` | **Built.** Migration pending |

The migration adds five columns to `tenants`. Until it runs, the endpoint fails. **Keep
`useMockApi: true`** and I will tell you when it lands. Nothing about the contract changes.

---

## 1. The endpoint — as specified

Request, response, reason ids and error codes exactly as you wrote them. Field keys PascalCase,
consistent with `PATCH /auth/me`.

`dataRetainedUntil` returns a real date: **30 days**, as your mock assumes. It is treated as a
commitment, and there is no automated deletion job behind it yet — so nothing will delete a
workspace on that date without someone deciding to build that, and when it is built it will have to
exclude reactivated workspaces. Noted in the code where it will be read.

---

## 2. Your §3 promises — all three are true

**Everyone loses access.** Every session for every member of the workspace is revoked, not just the
caller's, and each member's security stamp is bumped as well. That second part matters: revoking
refresh tokens alone would leave an employee's *access* token valid until it expired, so they would
keep working for up to fifteen minutes inside a workspace the owner believes is closed. Bumping the
stamp stops the token validating on the next request.

Inactive and suspended members are included too, so reinstating one later cannot hand back a live
session into a closed workspace.

**Campaigns stop.** This one needed a fix beyond the feature — see §3.

**Billing stops renewing.** The subscription moves to `Cancelled` with `AutoRenew` off and
`NextRenewalAt` cleared. The expiry-reminder countdown is also cleared, so the reminder job does not
email a closed workspace about a plan nobody is paying for.

All of it commits in **one transaction**. A workspace marked off whose sessions survived, or
sessions killed without the workspace being marked, are both worse than either outcome alone.

---

## 3. ⚠️ A live bug this uncovered

Building §3.2 I checked whether the dispatcher honours tenant status. **It did not** — and this is
not only a gap for deactivation.

`FindDueCampaignsAsync` runs with no principal, so the tenant query filter matches nothing and is
bypassed by design. It then filtered on campaign status alone. **So a tenant suspended by a platform
admin has been having their scheduled campaigns sent this whole time**, at their own cost per
conversation.

Fixed: the poll now requires the owning tenant to be `Active`. That closes it for deactivation,
suspension and cancellation together.

Worth knowing because it changes what "suspend a tenant" has meant until now — if any workspace has
been suspended in testing, its campaigns were still firing.

---

## 4. Decisions I made, per your invitations

**No permission, as you recommended.** Ownership is enforced by role — `Admin` or `SuperAdmin` — at
the API, not by the client hiding a card. An employee calling it directly gets `403` whatever the UI
does. I agree with your reasoning and did not introduce one.

**The WhatsApp number stays connected at Meta.** Nothing is disconnected, so reactivation does not
mean re-onboarding. Your copy is right as written.

**Webhooks are not yet blocked** on a deactivated tenant. Inbound events will still be processed and
stored. Nothing goes *out* — that is the part that costs money and the part your copy promises — but
if you would like inbound silenced too, say so; it is a small change and I did not want to make it
silently.

**Reactivation is not built.** Your copy says "contact support", which is honest today: a platform
admin can flip the tenant back with a direct update, but there is no Super Admin portal action for
it yet. Tell me if you want one and I will add it there rather than in the sign-in flow.

**Deletion is not built and I would keep it that way.** If you ever want it, it belongs behind
support with wording that deserves it, exactly as you said.

---

## 5. Security — your §2, confirmed

Tenant from the token. **No workspace identifier is accepted anywhere in the request**, and none
will be added. Ownership enforced server-side. The password is re-verified on every call regardless
of how recently the user signed in — it is the only thing between a session left open on a shared
laptop and a switched-off company.

`already_deactivated` returns `409`, so a double submit cannot re-stamp the reason or re-revoke.

---

## 6. Verified

```
Solution build   0 errors
Unit tests       218 passed, 0 failed   (10 new)
```

Covering the reason rules: each specific reason needs no explanation; `other` without details is
refused; whitespace does not count as details; a reason outside the agreed set is refused;
`temporary_pause` is present.

That last one has a test of its own for the reason you gave — it is the answer people would
otherwise misreport, and those are the accounts most worth contacting.

---

## 7. What to change

Nothing until the migration lands. Then flip `useMockApi` and your §6 checks should pass unchanged.

One thing to watch when you do: after a successful call, **every** token for that workspace is dead
immediately, including the caller's access token. Your result screen must not make any further API
call before **Sign out** — a profile refresh or a notification poll would 401 and could bounce the
user out of the result screen before they have read the retention date. Wiring the button to
`logout()` rather than a route was exactly right; just make sure nothing else fires in between.
