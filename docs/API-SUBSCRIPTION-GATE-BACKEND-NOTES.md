# A Workspace With No Plan — Backend Notes

The gate is in. This revision adds the two things your §4 and §6 asked for: `module` on a
module-level refusal, and the same `subscription_required` code on both kinds.

**Restart the API.** No migration.

---

## 1. Two refusals, one code, told apart by `module`

```jsonc
// no usable subscription at all  →  the client's "Purchase a plan"
{ "errorCode": "subscription_required",
  "detail": "This workspace has no active plan. Choose a plan to continue." }

// a plan that does not include the module  →  the client's "Upgrade plan"
{ "errorCode": "subscription_required",
  "detail": "The Starter plan does not include this feature. Upgrade to enable it.",
  "module": "whatsapp" }
```

**The module case was not returning that code at all.** `RequireModule` threw a bare
`forbidden`, so a write blocked by a missing module reached your interceptor as an error it did
not recognise — a red toast, not the upgrade dialog. Your §5 table says both rows should refuse
with `subscription_required`, and now both do. That was the real gap in this revision; the
`module` field you called optional is the smaller half of it.

Presence of `module` is the signal, as you described: absent means there is no usable
subscription, present means the workspace pays for something and not this. A test pins that the
whole-subscription refusal carries no module, and another pins that the two constants — they live
in different services — are the same string.

## 2. The broken-plan 404 is now a 500, so your fallback stops being wrong

You flagged this as the one case where `|| error.status === 404` misfires: a subscription pointing
at a deleted plan answers 404 with no code, so `missing` is true from the status fallback and a
paying customer gets locked out over a data fault.

Rather than wait for the code to reach every environment, I moved that case off 404 entirely. It
is a **500** carrying `plan_unavailable` and naming the plan id. Under your rules a 5xx is "no
answer" and fails open, which is the right direction for a fault on our side.

So the fallback is now correct in every case I can produce, and you can keep
`|| error.status === 404` as long as you like — it no longer has a wrong answer to give. The only
404 left on that route is the genuine no-plan one, and it carries `no_subscription`.

## 3. A third way past the gate, found while answering your §6

Writing the note about your dev workspaces, I claimed a stale trial row would keep one writable
because "expiry is a job's decision". I checked before sending it, and it is not: **nothing in
this codebase ever sets a subscription to `Expired`.** The reminder job only reminds.

So a subscription whose paid period ended last month still reads `Active` — to the gate, and to
`/subscription/entitlements`, and therefore to your `isLocked`. That is a third state that means
"no plan" and behaves like a plan, alongside the two in your report.

The gate now reads the end date as well as the status: active or trial **and** not past
`expiresAt`. `ResumeAsync` already reasoned this way for the same reason, which is what made me
look.

**This one is only half fixed.** Writes are refused, but the client will still show such a
workspace as `active`, because the entitlements endpoint reports the stored status. Two ways to
close it and I have not picked one unasked:

- **derive it on read** — report `expired` when the date has passed, wherever the status is
  returned. One line, no migration, self-correcting;
- **a nightly job** that moves lapsed rows to `Expired`, which also makes the column honest for
  anyone reading the database directly.

I would do both, the first today and the second when someone wants the data tidy. Say the word.

## 4. The gate

Writes from a workspace without an **active** or **trial** subscription are refused:

```
403  { "errorCode": "subscription_required",
       "detail": "This workspace has no active plan. Choose a plan to continue." }
```

Middleware with an allow-list of exempt prefixes, as you suggested — not per-endpoint checks.

**"Active" means `active` or `trial`.** Not expired, suspended, cancelled, and **not the absence of
a subscription**, which is the case the whole thing exists for and the one a check written against
statuses waves through on either side of the wire. The same four states you lock on.

Reads are never refused. A workspace that lapses can still see everything it has, which is what
"nothing has been deleted" promises.

**On the message:** the code is per-refusal, the copy is per-action. A gate covering every write
cannot know it stopped "add contacts" specifically, so it sends the code and leaves the sentence
to the client, which does know.

## 5. The exempt list

```
/subscription  /billing  /plans        ← the way out. Refusing these locks the customer out of paying.
/auth  /security  /notifications  /workspace
/superadmin  /admin  /dev
/whatsapp/webhook
```

Your "`/settings` for the profile" maps to two routes here, both already covered: the profile edit
is `PATCH /auth/me`, and the billing profile is `PUT /billing/profile`.

Three exemptions are not on your list and are worth flagging:

- **`/whatsapp/webhook`** — the one that would have hurt. It is `[AllowAnonymous]` and carries no
  token, so a lapsed plan must never refuse it: Meta retries, and a customer's inbound messages
  are not ours to lose over an unpaid invoice. Exempt by prefix *and* by having no tenant, so a
  future change to webhook auth cannot quietly break it.
- **`/security` and `/notifications`** — ending a device, marking a notification read. Housekeeping
  on your own account, not using the product.
- **`/workspace`** — correcting the company's own details while sorting out a lapse.

Everything on your list is gated, auto-reply included (`/whatsapp/auto-reply`), plus employees,
permission sets, AI and business discovery. Business discovery especially — it spends money per
search.

**Platform staff are never gated.** Support is most needed on the workspace that has not paid.

## 6. Cost

One column, one row, cached 15 seconds per workspace, cleared outright whenever a plan changes or
a payment is approved — so a customer who has just paid is not locked out for the rest of the
window. The entitlements endpoint answers a richer question at the cost of eight queries, which is
the wrong trade for something on every write.

## 7. Worth knowing before you restart

**18 of your 24 dev workspaces have no subscription row at all.** They become read-only the moment
you restart — intended, and the point of the report, but a lot of accounts to discover at once.
Tenants 1, 6, 15, 17, 18 and 23 have one; the rest do not.

## 8. Tests

18 in `SubscriptionGateTests`: active and trial writable; expired, suspended and cancelled not;
**a workspace that never bought anything not** — the reported bug in one line; the refusal carrying
`subscription_required` and a 403; platform staff exempt; a request with no workspace exempt; the
answer read once and remembered; and paying taking effect without waiting out the cache.

Four are new in this revision: the whole-subscription refusal carrying **no** module; a plan
without the module refused **with** it named; a plan that has it not refused; and the two
constants in the two services asserted equal, since that string is what your interceptor listens
for and they cannot be allowed to drift apart.

Two more pin the entitlements contract now that it is load-bearing on your side: a workspace with
no plan getting a 404 rather than an empty snapshot, and that 404 naming its reason.

Full unit suite: **830 passing**. API builds clean, no new warnings.

## 9. Your §6, answered back

**The 200.** Noted that both shapes would lock now, and that `== null` closed the gap. I have
left it as a 404 anyway — it is what you shipped against, it is unambiguous, and there is no
longer anything to gain from changing it. If you ever do want the 200, say so and it comes back
with `no_subscription` on it.

**The four writes that now ask before they spend.** Business discovery is the one I would have
picked too, for exactly your reason. Worth knowing that it is gated twice now: your pre-check,
and the API refusing the write — and `POST /business-discovery/search` is a write to the gate, so
a workspace with no plan cannot reach the provider through it even with curl.

**`PUT /employees/{id}/permissions`, "no module".** Correct — there is no module for it, and the
API refuses it on the subscription alone, so that refusal arrives with no `module` field and your
"Purchase a plan" variant is the right one.

**The dev workspaces.** Your trial-row suggestion is right, with one correction to what I nearly
told you: give the row an `expires_at` in the future. I was about to say a stale date would not
matter, which sent me to check, which found §3 — so the row needs a real date now, and a trial
one is enough.
