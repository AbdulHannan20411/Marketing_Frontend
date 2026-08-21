# Account Profile — Backend Response

Answer to `API-ACCOUNT-PROFILE.md`. `PATCH /auth/me` is built. I took the atomic option you offered
in §3, so **the ordering constraint no longer exists** and there is no partial-success case left to
handle.

Base path: `/api/v1/auth`.

---

## 0. Status

| Method | Path | State |
| --- | --- | --- |
| GET | `/auth/me` | Unchanged |
| PATCH | `/auth/me` | **Built**, and it accepts the password too — §1 |
| POST | `/auth/change-password` | Unchanged, still works. Keep it or drop it — §3 |

Everything in §1 and §4 of your document is implemented exactly as written. Field names, optional
semantics, `currentPassword` gating, PascalCase error keys, `email_in_use` — all as specified.

---

## 1. One call does all three

```jsonc
PATCH /auth/me
{
  "displayName": "Amara Okafor",     // optional
  "email": "amara@nextreach.io",     // optional
  "newPassword": "…",                // optional  ← new
  "currentPassword": "…"             // required when email OR newPassword is present
}
```

Applied in a single transaction. **Delete the two-call orchestration and the ordering comment** —
`PATCH` first then `POST` is no longer needed, and neither is the *"Details saved, password
unchanged"* partial-success message. There is no longer a state where one applies and the other does
not.

`currentPassword` is now required for the password as well as the email, which is what makes the
single call safe. A rename alone still asks for nothing — as you argued, gating that would just
train people to type their password without thinking.

Absent still means leave alone, never clear. Response is the full `GET /auth/me` shape.

### Errors — unchanged from your spec

| Status | Key | When |
| --- | --- | --- |
| 422 | `errors.CurrentPassword` | Wrong current password |
| 422 | `errors.Email` | Malformed address |
| 422 | `errors.DisplayName` | Empty after trimming, or over 120 characters |
| 422 | `errors.NewPassword` | Fails the password policy |
| 409 | `email_in_use` | Another account already uses that address |

---

## 2. Your two questions about `change-password` — both confirmed true

**Other sessions are revoked.** Every other session gets `RevokedOn` set with the reason *"Password
changed."*. Your *"Other devices have been signed out"* message is accurate — **keep it**.

**The current session survives.** It is explicitly re-stamped so it lives through the rotation that
invalidates everything else. The user stays on the Settings page.

Both now apply to `PATCH /auth/me` as well, since it shares the same revocation path.

---

## 3. `POST /auth/change-password` still works

Unchanged and still live, so nothing breaks the moment you deploy. Once you have switched to the
combined call it becomes redundant — tell me if you would like it removed, or it can stay for
non-browser callers.

---

## 4. Your password policy mirror is missing a rule

You have length ≥ 12, a letter and a digit. Those are right. The server also rejects passwords
**containing any of these fragments**, case-insensitively:

```
password   qwerty   welcome   letmein   marketing   whatsapp   123456
```

So `marketingplan2026` passes your client-side check at 17 characters with letters and digits, and
is then rejected by the server with `errors.NewPassword` — which reads as an unexplained failure
after the strength bar said it was fine.

Worth adding to `passwordRules` in `core/models/password-policy.ts`. The wording the server uses is
*"not contain a common word or pattern"*.

The minimum length is configuration (`MinimumPasswordLength`, currently 12), so if it is ever raised
your mirror goes stale silently. If that matters, I can expose the policy on an endpoint for you to
read at startup — say the word.

---

## 5. Email change — answering your §5

**Notifying the old address: done.** Any address change now emails the *previous* address saying it
was changed and to contact support if unexpected. It is best-effort and after the commit — a bounced
warning will not fail a change the user already saw succeed. No UI needed, as you said.

**Verifying the new address: not built, and I would leave it.** Your current copy —
*"You will sign in with this address from now on"* — is true today and should stay.

The reasoning: verification only helps against a typo, since a genuine attacker who has the session
and the password can confirm from the new address anyway. What it costs is real — a pending state,
a confirmation screen, an expiry, a resend, and a period where the account has two addresses and it
is ambiguous which one signs in. The old-address warning covers the takeover case, which is the one
that actually matters.

**If you want it anyway, say so and I will build it** — but as you asked, I will not ship it
silently, because the UI would then be claiming a change that has not happened.

---

## 6. What to change

1. **Send `newPassword` on `PATCH /auth/me`** and drop the second call (§1).
2. **Remove the ordering workaround** and the *"Details saved, password unchanged"* branch — that
   state no longer exists (§1).
3. **Add the forbidden-fragment rule** to the client-side policy (§4).
4. **Keep** the *"Other devices have been signed out"* message — it is true (§2).

Your §7 verification list should pass unchanged, except that "name + email + password together" is
now one request rather than two.

---

## 7. Verified

```
Solution build   0 errors
Unit tests       192 passed, 0 failed   (8 new on this endpoint)
```

Covering: rename asks for no password; a wrong current password changes nothing; a taken address
returns `email_in_use`; the old address is warned; a bounced warning does not undo the change; name,
email and password all apply in one call; an absent field is left alone rather than cleared; a name
that trims to nothing is refused.
