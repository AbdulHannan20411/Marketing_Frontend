# Account Profile — Name, Email and Password

Integration record for the "Edit your profile" panel in Settings. Any signed-in user — admin or
employee — can change their own **name**, **email** and **password**, individually or all three at
once.

The endpoint is live and the client is integrated against it. This document is the contract as
delivered, plus what the front end does with it.

Base path: `/api/v1/auth`.

> This is a user editing **their own** account. Admins editing *other* people is the separate
> employee-management flow and is unaffected.

---

## 0. Status — integrated

`PATCH /auth/me` is built and takes the password too. The client sends **one request** for all three
changes; the two-call orchestration and its partial-success handling are gone.

| Method | Path | State |
| --- | --- | --- |
| GET | `/auth/me` | Live |
| PATCH | `/auth/me` | **Live** — name, email and password in one transaction |
| POST | `/auth/change-password` | Live, and **no longer called by this client** — see §3 |

---

## 1. `PATCH /auth/me`

```jsonc
PATCH /auth/me
{
  "displayName": "Amara Okafor",     // optional
  "email": "amara@nextreach.io",     // optional
  "newPassword": "…",                // optional
  "currentPassword": "…"             // required when email OR newPassword is present
}
```

Every field is optional; absent means "leave alone", never "clear". All three apply in a single
transaction, so there is no state where one takes and another does not.

| Field | Rules |
| --- | --- |
| `displayName` | 1–120 characters after trimming. Rejected if it trims to empty |
| `email` | Valid address, unique across all users, stored normalised |
| `newPassword` | Must pass the policy in §4 |
| `currentPassword` | Required whenever `email` or `newPassword` is present |

### Why `currentPassword` guards email and password but not the name

Both are account-takeover steps: whoever controls the address controls password resets. A session
left open on a shared machine should not be enough to perform either. Renaming yourself is not
dangerous, and gating it would only train people to type their password without thinking.

### Errors

| Status | Key | When |
| --- | --- | --- |
| 422 | `errors.CurrentPassword` | Wrong current password |
| 422 | `errors.Email` | Malformed address |
| 422 | `errors.DisplayName` | Empty after trimming, or over 120 characters |
| 422 | `errors.NewPassword` | Fails the password policy |
| 409 | `email_in_use` | Another account already uses that address |

Field keys are **PascalCase**; the client matches case-insensitively.

---

## 2. Session behaviour — confirmed, and the copy is accurate

Both confirmed by the backend, and both now apply to `PATCH /auth/me` since it shares the revocation
path:

- **Other sessions are revoked** on a password change, with the reason *"Password changed."* The
  UI's *"Other devices have been signed out"* is therefore true, and **stays**.
- **The current session survives** the rotation, so the user stays on the Settings page rather than
  being bounced to sign-in mid-flow.

---

## 3. `POST /auth/change-password` — no longer used by this client

The combined call replaces it, so `changePassword()` has been **removed from the Angular service**
rather than left as dead code with no callers.

**Our vote: keep the endpoint server-side.** It costs nothing to leave, and it is the obvious entry
point for any non-browser caller. But nothing in this front end will call it again.

### The ordering constraint is gone

For the record, since it shaped the previous version of this document: when the email change was
confirmed with the current password and the password change was a *separate* call, the order was
load-bearing. Change the password first and the confirmation was stale by the time the email call
ran, so "change my email and password" failed every time. The atomic endpoint removes the problem
entirely — there is no second call to be stale.

---

## 4. Multi-tenancy and permissions

The user is resolved **entirely from the JWT**. There is no id in the path or body, and the endpoint
must never accept one — that would be a horizontal-privilege-escalation hole, letting any user edit
any other by guessing an id.

No permission is required beyond being authenticated: everyone can edit their own account. Employees
and admins use the identical endpoint. `TenantId` is untouched by this operation.

---

## 5. Password policy, and the email question

### The policy mirror now matches

`core/models/password-policy.ts` enforces all four rules, in the server's own wording:

- At least 12 characters
- Contains a letter
- Contains a digit
- **Does not contain a common word or pattern** — `password`, `qwerty`, `welcome`, `letmein`,
  `marketing`, `whatsapp`, `123456`

The fourth was missing, which is exactly the case the backend flagged: `marketingplan2026` passed
every visible rule at seventeen characters with letters and digits, showed a full strength bar, and
was then refused by the server as an unexplained failure. It is now marked unmet as the user types.

Adding it exposed a second bug of our own: the strength bar scored by counting rules met and capped
at three, so three-of-four still rendered full. A full bar is now reserved for a password that
actually passes.

**On exposing the policy from an endpoint: not needed, thank you.** If `MinimumPasswordLength` is
raised the mirror goes stale, but the failure mode is a server rejection rendered inline beside the
field — survivable, and cheaper than a startup fetch on every page load. Just tell us if it changes
and we will edit the one constant. If the *forbidden list* grows, the same applies.

### Email change

**Old-address notification: noted, and it needs nothing from us.** Good.

**Verification: agreed, leave it.** Your reasoning is right — an attacker holding the session and
the password can confirm from the new address anyway, so verification only catches typos, while the
cost is a pending state, an expiry, a resend, and a window where two addresses exist and it is
ambiguous which one signs in. The old-address warning covers the case that matters.

The copy stays as *"You will sign in with this address from now on,"* which is true.

---

## 6. Front-end status

| Piece | File |
| --- | --- |
| `UpdateProfileRequest` | `core/models/auth.model.ts` |
| Password policy, shared with the invitation/reset screen | `core/models/password-policy.ts` |
| `updateProfile` — the single call | `core/auth/auth.service.ts` |
| The form and its validation | `features/settings/settings.component.*` |

### Behaviour worth knowing

- The current-password field appears **only** when the email or password is changing, and its
  explanation names which — *"Required because you are changing your email and password."*
- The password rules render live with a strength bar; confirm-password appears only once a new
  password is being typed.
- Save is disabled until something has actually changed, and says so.
- API field errors render **beside the offending input**, not as a toast — a toast repeating an
  inline message is just noise. A failure with no field errors still gets a toast.
- After a successful save the session profile is reloaded, so the top bar and avatar update
  immediately.

---

## 7. Verified

Against the mock, which applies the same rules — PascalCase field errors, the forbidden fragments,
and validate-everything-before-writing-anything so a partial apply cannot slip through:

- Name only → saves without asking for a password; top bar and avatar update immediately.
- `marketingplan2026` → the fourth rule shows unmet, the strength bar sits at two of three, and
  submitting is refused client-side before any request is made.
- Wrong current password → *"That is not your current password."* renders under the current-password
  input, with no duplicate toast.
- Name + email + password together → **one request**, all three applied, and the toast reads
  *"Your details were updated and your password was changed. Other devices have been signed out."*
- Re-submitting afterwards with the **old** password is rejected, confirming the password really
  changed inside that same call.
- A name change submitted with a wrong current password leaves the name **unchanged** — nothing is
  partially applied.
- No horizontal scroll at 375 px with the form open.

To exercise it without a backend, set `useMockApi: true` in `web/src/environments/environment.ts`.
