# Workspace Deactivation — Backend Requirements

One endpoint. The tenant owner switches their whole workspace off from Settings, giving a reason and
confirming twice.

Built on both sides to the shape below. The migration is still pending, so the client runs against
its mock for now — see §0.

Base path: `/api/v1`.

---

## 0. Status — built, awaiting migration

The endpoint is built to this shape. The migration adding the `tenants` columns has **not** run, so
it fails today and `useMockApi` stays `true` until the backend confirms it has landed.

### What this is, and what it is not

**Deactivation, not deletion.** The workspace stops working and the data is kept — the UI promises
exactly that. Permanent deletion is not built and should stay unbuilt: if it is ever wanted, it
belongs behind support with wording that deserves it.

**Workspace, not user.** The tenant owner is switching off the company account; every employee loses
access too. The UI says "workspace" everywhere and never "your account", because an admin who
thought they were removing only themselves would be very surprised.

---

## 1. `POST /workspace/deactivate`

```jsonc
{
  "reason": "too_expensive",
  "details": "Moving to a cheaper plan elsewhere.",   // nullable
  "currentPassword": "…"
}
```

| Field | Rules |
| --- | --- |
| `reason` | Required. One of the six ids below |
| `details` | Free text, nullable. **Required when `reason` is `other`** — the client enforces this too, but a reason of "something else" with no text tells you nothing |
| `currentPassword` | Required. Verify it like `PATCH /auth/me` does |

Reason ids, fixed and shared with the client:

```
too_expensive · missing_features · switching_provider ·
no_longer_needed · temporary_pause · other
```

`temporary_pause` exists deliberately — it is a common honest answer, and omitting it would push
those users into picking something that misrepresents why they left, which makes the churn data
worse rather than better. Worth reporting on separately: those are the ones most likely to return.

### Response

```jsonc
{
  "deactivatedAt": "2026-08-21T14:22:10Z",
  "dataRetainedUntil": "2026-09-20"
}
```

| Field | Notes |
| --- | --- |
| `deactivatedAt` | When access ended. Immediate today, but the server decides |
| `dataRetainedUntil` | Date or `null`. Shown to the user so "deactivated" does not read as "gone". **`null` is fine** — the UI then makes no retention promise rather than inventing one |

### Errors

| Status | Key / code | When |
| --- | --- | --- |
| 422 | `errors.CurrentPassword` | Wrong password |
| 422 | `errors.Reason` | Missing or unrecognised reason |
| 422 | `errors.Details` | `other` with no details |
| 403 | `forbidden` | Caller is not the workspace owner |
| 409 | `already_deactivated` | Workspace is already off |

Field keys **PascalCase**, consistent with `PATCH /auth/me` and `change-password`. The client
matches case-insensitively and renders the message beside the offending input.

---

## 2. Authorisation — the important part

**Tenant comes from the token. No workspace id is sent, and the endpoint must never accept one.**
An id in the body would let any admin switch off any other workspace by guessing.

**Owner only.** The client gates on role `Admin` and hides the card from employees, but that is
presentation. Enforce it server-side: an employee calling this directly must get `403`, whatever the
UI does.

There is deliberately **no permission** for this. A permission could be granted to an employee by an
admin who did not think it through; "can switch off the company" should follow ownership, not a
checkbox. If you disagree, say so before adding one — it is easier not to introduce it than to take
it away later.

**Re-verify the password server-side.** It is the only thing standing between a session left open on
a shared laptop and a switched-off company.

---

## 3. What deactivation must actually do

The UI promises these three things explicitly, so they need to be true:

1. **Everyone in the workspace loses access.** Revoke every session and refresh token for every user
   in the tenant, not just the caller's. An employee with a live token must stop working within the
   token's lifetime at worst — ideally immediately.
2. **Scheduled and recurring campaigns stop.** The dispatcher must not fire for a deactivated
   tenant. This is the one with real-world consequences: messages going out from a workspace the
   owner believes is off is the worst possible failure of this feature, and it costs them money per
   conversation.
3. **Billing stops renewing.** Cancel or suspend the subscription so the next cycle does not charge.

Also worth doing, though the UI does not promise them:

- Stop inbound webhook processing, or at least stop acting on it.
- Leave the WhatsApp number connected at Meta rather than disconnecting — reconnecting is painful,
  and this is meant to be reversible. If you decide otherwise, tell us and the copy changes.
- Record who deactivated, when, and the reason, in the audit log.

### Confirmed by the backend

All three promises hold, in **one transaction** — a workspace marked off whose sessions survived, or
sessions killed without the workspace being marked, are both worse than either outcome alone.

Two details worth recording:

- **Security stamps are bumped, not just refresh tokens revoked.** Revoking refresh tokens alone
  would leave an employee's *access* token valid until it expired — up to fifteen minutes still
  working inside a workspace the owner believes is closed.
- **The expiry-reminder countdown is cleared**, so the reminder job does not email a closed
  workspace about a plan nobody is paying for.

The WhatsApp number **stays connected at Meta**, so reactivation is not a re-onboarding. The copy is
written on that basis.

### A live bug this uncovered

Building the campaign-stop, the backend found `FindDueCampaignsAsync` ran with no principal — so the
tenant query filter was bypassed — and filtered on campaign status alone. **Tenants suspended by a
platform admin were still having their scheduled campaigns sent**, at their own cost per
conversation. The poll now requires the owning tenant to be `Active`, which closes it for
deactivation, suspension and cancellation together.

Nothing for the front end to change, but it means "suspend a tenant" did not previously do what the
Super Admin portal implied. Any workspace suspended during testing was still firing campaigns.

### Reactivation

Not built, and not in the UI. The copy says "contact support before then to bring the workspace
back", which is honest: a platform admin can flip the tenant back directly, but there is no Super
Admin portal action for it yet.

If one is built, the Super Admin portal is the right home — not the sign-in flow, which would mean
showing a reactivation path to anyone who typed the right email.

### Inbound webhooks

Still processed and stored for a deactivated tenant. **We think that is correct and would leave it.**
Nothing goes *out*, which is what costs money and what the copy promises; and keeping inbound events
means a reactivated workspace still has the conversations that arrived while it was off. Silencing
them would lose that history for no benefit the user can see.

---

## 4. Retention

**Thirty days**, returned as a real date and treated as a commitment. The client displays it
verbatim and assumes nothing about the period.

There is **no automated deletion job** behind it yet. When one is built it must exclude reactivated
workspaces — deleting a workspace that came back would be unrecoverable and entirely self-inflicted.

Two things to get right:

- **Whatever date you return, honour it.** It is shown to a customer as a commitment.
- **If deletion after expiry is automated**, make sure a reactivated workspace is taken out of the
  queue. Deleting a workspace that came back would be unrecoverable and entirely self-inflicted.

Return `null` rather than a guess if the policy is not settled — the UI degrades to "contact support
if you would like the workspace brought back", which is honest.

---

## 5. What the front end does

| Piece | File |
| --- | --- |
| Reasons, request and result types | `core/models/workspace.model.ts` |
| The single API call | `core/services/workspace.service.ts` |
| Danger-zone card and both dialogs | `features/settings/settings.component.*` |

The flow, in order:

1. A **danger-zone card** at the bottom of Settings, visible only to `Admin`, stating plainly what
   deactivation does and that it is not a deletion.
2. **Stage one — why.** Six reasons as radio options plus a details box. Continue stays disabled
   until a reason is chosen, and until details are filled if the reason is `other`.
3. **Stage two — are you sure.** Consequences in red, then two gates: type the exact workspace name,
   and enter the current password. The confirm button stays disabled until both are satisfied.
4. **Result.** Confirms it is off, shows the retention date if given, and the only action is
   **Sign out** — which calls `logout()` and clears the tokens, rather than navigating to the login
   route and being bounced straight back in by the auth guard.

Two stages on purpose: asking *why* and asking *are you sure* are different questions, and merging
them makes the confirmation something you click past on the way to the reason picker.

---

## 6. Sessions die immediately — what the client does about it

Every token for the workspace, including the caller's own access token, is dead the moment the call
returns. So **nothing may fire between the result screen appearing and the user signing out**: a
401 would fail its refresh, and the interceptor's `clearSession()` would navigate the user away
before they had read the retention date.

Two things guarantee that:

- **The workspace name is captured at success**, not read from the live session. Otherwise the
  goodbye message would be addressed to nobody the moment anything cleared the session underneath.
- **The realtime hub is disconnected** on success, so it stops retrying with a revoked token.

Nothing else on Settings polls — the import poller is scoped to the import pages — and **Sign out**
calls `logout()` rather than navigating, so it clears the tokens instead of bouncing off the auth
guard.

---

## 7. Verified

Against the mock, which verifies the password exactly as the real endpoint does:

- The card appears for an **Admin** and not for an **Employee**, who still sees the rest of Settings
  including their own profile.
- Continue is disabled with no reason selected; **Something else** makes details required and keeps
  it disabled until they are filled; a specific reason does not.
- The confirm button stays disabled for a near-miss workspace name (`Northwind Retai`), and with the
  correct name but no password.
- A **wrong password** is rejected inline — *"That is not your current password."* — with nothing
  deactivated and the dialog still open.
- The correct password returns the result screen with the retention date.
- **The farewell survives the session dying underneath it**: clearing both tokens while it is open
  leaves it showing, still correctly naming the workspace. Before the name was captured, that line
  rendered blank.
- **Sign out** clears the tokens and lands on `/auth/login`, including from that state.
- No horizontal scroll at 375 px; the dialog fits the viewport.

To exercise it without a backend, set `useMockApi: true` in `web/src/environments/environment.ts`.
