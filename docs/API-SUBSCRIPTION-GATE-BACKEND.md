> **Resolved.** The write gate is live — `403 subscription_required` from middleware with an
> exempt allow-list — and `/subscription/entitlements` stays a 404, now carrying
> `errorCode: "no_subscription"`. The client keys on that code (falling back to the status), turns
> the refusal into the upgrade offer, and gates eleven write actions before they run. Kept for the
> record; §4 describes the client as it now behaves.

# A Workspace With No Plan Can Use the Product

Reported and confirmed: an admin who has never bought a plan could add contacts, run an import,
build campaigns — everything. The client is fixed; **the API is the boundary that matters** and
this is what it needs.

## 1. What the client did wrong, and now does

`isLocked` read the subscription's status:

```ts
const status = this.subscription()?.status;
return status === 'suspended' || status === 'expired';
```

`undefined` — no subscription at all — fell through as "not locked", and `cancelled` was never
listed. So the two states that mean *no plan* were the two that opened the product.

Now four states lock: `none` (the read succeeded and there is no subscription), `cancelled`,
`expired`, `suspended`. Two deliberately do not:

- **A failed entitlement read.** "The API did not answer" is not "there is no plan"; locking a
  paying customer out over a dropped request would be worse than the bug being fixed.
- **Before the answer arrives.** No flash of a lock screen on every page load.

Locked, the shell keeps the account reachable — subscription, pricing, settings, account — and
redirects everything else there, with copy per reason ("Choose a plan to start using the
workspace"). Six tests pin it.

## 2. What the API must do, because the client cannot

**A locked client is a UI, not a boundary.** `POST /contacts`, `POST /contacts/imports`,
`POST /campaigns` and the rest are reachable with a token and a curl command whatever the screen
shows. So:

**Refuse writes without an active or trialling subscription.** A `403` with a code the client can
recognise:

```jsonc
{ "errorCode": "subscription_required",
  "title": "This workspace has no active plan",
  "detail": "Choose a plan to add contacts." }
```

Applied to the write side of the tenant-scoped modules — contacts, imports, groups, tags,
campaigns, templates, auto-reply — and **not** to:

- **Reads.** A workspace that lapses must still be able to see what it has; hiding the data is a
  worse answer than pausing the product, and it is what "nothing has been deleted" on our screen
  promises.
- **Anything needed to fix it** — `/subscription`, `/billing`, `/payments`, `/auth`, `/settings`
  for the profile. Refusing those would lock the customer out of paying you.
- **Platform staff.** A Super Admin acting through `?adminId=` is not subject to the customer's
  plan.

A filter or a policy at the module level is cheaper and more reliable than per-endpoint checks; the
list above is short enough to be an allow-list of exempt prefixes, which is how
`scopeInterceptor` already reasons about the same routes.

### What "active" means here

`active` or `trial`. Not `expired`, `suspended`, `cancelled`, and not the absence of a
subscription — the four the client now locks on, so the two sides agree on the same rule.

## 3. The thing I could not check — answered, and it was the whole bug

I asked whether `GET /subscription/entitlements` answers `200` with an empty snapshot or `404` for a
workspace with no plan. **It is a 404**:

```csharp
// BillingService.LoadSubscriptionAsync
?? throw new NotFoundException("This organisation has no subscription.");
```

To `HttpClient` that is an error like any other, and both of the client's error paths deliberately
fail **open** — a dropped request must not lock a paying customer out. So the one state that should
have granted nothing granted everything: no lock, and `hasFeature` answering `true` for every
module. That is why a brand-new workspace could add contacts, import them, create tags and reach
the WhatsApp connection.

**Fixed on the client**, and the fix is that a 404 is now kept apart from every other failure: it is
an *answer* ("there is no plan"), not a *missing answer*. A 404 locks and grants no modules; a 500,
a timeout or a network failure still fails open. Six tests hold that line, including "keeps every
module while the answer is unknown".

No change needed on your side for that. Leaving the 404 as it is, is fine — it is unambiguous, and
now that the client reads it correctly it is arguably better than a 200 carrying an empty object.
The only thing worth considering is adding `errorCode: "no_subscription"` to that response, so the
client can key on the code rather than the status; the status is enough today and I have not asked
for it.

## 4. What is now true on the client — this replaces §4 of the version you may already have

**The product decision changed after the first draft of this document, and it changes what the
client looks like — not what the API must do.** If you have the earlier version, replace this
section; §2 is unchanged and is still the ask.

Screens are **not** hidden and routes are **not** redirected any more. A workspace with no plan, or
with a plan that does not include a module, can open every screen and read it. This is deliberate:
somebody who cannot see contacts, campaigns or reports has no reason to buy them, and a menu with
two thirds missing looks broken rather than upgradeable.

The boundary moved to the **actions**:

- Creating, editing, deleting, importing, connecting a number — each checks the plan first and, if
  it is not covered, opens one dialog instead of doing the work.
- The dialog has two versions. **Purchase a plan** when there is no usable subscription at all
  (never bought, expired, cancelled, suspended) and **Upgrade plan** when there is one and it does
  not include that module. Telling somebody who already pays to "buy a plan" reads as though their
  money went nowhere.
- Everything else still works: reading, filtering, sorting, exporting, and the whole account and
  billing area.

What stays hidden is what **permission** hides — an employee without `contacts.view` still does not
see contacts. That is a different kind of no: they are not a customer who might upgrade.

### What this means for you

Nothing in §2 changes, and if anything it matters more: the client no longer blocks navigation at
all, so **the API is the only thing standing between a workspace with no plan and a write**. A
`403` with `errorCode: "subscription_required"` is what the client listens for — it turns that
refusal back into the same upgrade dialog rather than a red toast, so a write the client failed to
gate still ends as an offer.

One small request that follows from the two dialog variants: where the refusal is about a **module**
rather than the subscription as a whole, naming it helps —

```jsonc
{ "errorCode": "subscription_required", "detail": "…", "module": "whatsapp" }
```

The client will say "WhatsApp campaigns and templates are part of a higher plan" instead of the
generic line. Entirely optional; without it the dialog still opens and still offers the upgrade.

## 5. Taken together

| | Client | API |
| --- | --- | --- |
| No plan / cancelled / expired / suspended | Screens readable; every write opens "Purchase a plan" | Writes refused with `subscription_required` |
| Plan lacks a module | Screens readable; every write opens "Upgrade plan" | Writes refused with `subscription_required` |
| Read-only access to existing data | Allowed | Allowed |
| Route to pay | Always reachable | Always reachable |
| Platform staff | Never locked | Never locked |

The client half is shipped. Until the API half lands, the gate is a suggestion.

---

## 6. Answering your notes — the gate is in, so this section closes the loop

Read against your reverted-404 build. Nothing here asks for work; two items are answers you
explicitly asked for, one is a change I made on this side, and one is a flag.

### `none` is not synthesised from a literal — and now it cannot be

You asked which of two readings applies, because the second silently reintroduces the bug. The
answer is the safe one, and it was already the safe one:

```ts
if (this.noPlan()) return 'none';        // the 404 branch — `no_subscription` or a bare 404
const status = this.subscription()?.status;
if (status == null) return 'none';       // no snapshot, or a snapshot with no status
```

`none` is synthesised from *the absence of a plan*, by either route. So your 200-with-`status: null`
build would have locked correctly too — the second branch catches it.

One change on the back of your note. That line read `status === undefined`, which is true for an
absent field and **false for an explicit `null`** — so a payload carrying `status: null` would have
fallen through to the four status comparisons, all false, and reported the workspace unlocked. That
is the exact failure you described. It is now `== null`, which catches both, with a test pinning a
200 that carries no status. Reverting was right; this means it would not have mattered either way.

**So you are free to move that endpoint back to a 200 whenever you like.** Both shapes lock. If you
do, keep `errorCode: "no_subscription"` on whatever the no-plan answer becomes — see below.

### `no_subscription` was worth adding

You added it without being asked and flagged that it could be ignored. It is not ignored, and the
reasoning behind it is the reasoning this client already shipped:

```ts
const missing = error.errorCode === 'no_subscription' || error.status === 404;
```

The code is read first, the status second. Keeping the status as a fallback is deliberate rather than
lazy: an API old enough to answer a bare 404 is one this client has already shipped against, and
dropping the fallback would fail *open* there. Your point about a renamed path or a version bump is
the one that makes the code load-bearing, and it is why this reads the way it does.

Your call on a subscription pointing at a deleted plan — ordinary 404, not `no_subscription` — is
right and this client handles it correctly: no code, a 404, so `missing` is true from the status
fallback… which locks a paying customer over a broken row. **That is the one case where the fallback
is wrong**, and it only stops being wrong once every deployed API sends the code. I am leaving the
fallback in for now because a broken plan row is rare and an old API is not; tell me when the code
is on every environment and I will drop `|| error.status === 404` in the same commit.

### Four writes now ask before they spend

Your gated list included four things this client was letting through to the 403. The interceptor
catches `subscription_required` and turns it into the same dialog, so nothing was broken — but the
refusal arrived *after* the work. These now check first:

| Write | Checked as |
| --- | --- |
| `POST /ai/generate` | "Using the AI assistant", module `ai` |
| `PUT /whatsapp/auto-reply` | "Saving auto-reply", module `ai` |
| `POST /business-discovery/search` | "Searching for nearby businesses", module `crm` |
| `PUT /employees/{id}/permissions` | "Changing permissions", no module |

Business discovery is the one that mattered, for your reason: it spends money per search, and the
person had already picked a category and a radius before being told no.

### Your exempt list matches what this client leaves ungated

Nothing on the client gates `/auth`, `/security`, `/notifications` or `/workspace` — ending a device,
marking a notification read and correcting the company's own details are housekeeping, as you say.
`/subscription`, `/billing` and `/plans` are the route out and the gate dialog's own call to action
points at them, so gating those would have made the dialog a dead end.

`/whatsapp/webhook` never occurred to me and you are right that it is the one that would have hurt.
Nothing on this side touches it.

### §5 — the 18 dev workspaces

Expected, and it is the report reproducing itself 18 times. Worth knowing for whoever hits it: those
workspaces stay fully **readable**, every write opens "Purchase a plan", and the way out is the
dialog's own button. If a dev workspace needs to be writable, giving it a trial row is enough — the
gate treats `trial` as active, and the entitlements cache clears on a plan change, so it takes
effect immediately rather than 15 seconds later.
