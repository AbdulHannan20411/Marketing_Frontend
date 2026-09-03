# WhatsApp Connect — Onboarding Steps

Your assessment was right on both counts, and this closes the first one. Connect is now
asynchronous and reports per-step progress, so §1–§4 of your doc has something real to bind to.

I was also wrong in an earlier note when I told you to "expect `status: pending` first". At that
point `Pending` was written to the database and overwritten before the response was built, so the
caller never saw it. You were correct that the polling path was unreachable. That is fixed here
rather than argued about.

---

## What changed

`POST /whatsapp/connect` used to do everything in one request: exchange the code, subscribe to
webhooks, register the number, read the profile, then return. Three of those are round trips to
Meta that regularly take seconds and each fail for their own reason.

Now it exchanges the code, stores the credential, and **returns immediately** with
`status: "pending"`. A scheduler picks the connection up **within five seconds** and runs the rest,
updating each step as it goes.

Nothing about your request shape changes. `{ code, wabaId, phoneNumberId }` is still what
`launch()` gives you and still what the endpoint takes.

---

## The new field

`WhatsAppConnectionResponse` gains `onboarding`, and it is **never null** — a connection that was
never attempted reports an idle set, so you render one shape rather than branching on absence.

```ts
interface ConnectionOnboarding {
  readonly running: boolean;
  readonly currentStep: OnboardingStep | null;
  readonly steps: readonly OnboardingStepState[];
}

interface OnboardingStepState {
  readonly step: OnboardingStep;
  readonly status: OnboardingStepStatus;
  readonly code: string | null;      // failure cause, stable
  readonly message: string | null;   // operator detail, NOT end-user copy
  readonly completedAt: string | null;
}

type OnboardingStep = 'token' | 'subscribe' | 'register' | 'profile';
type OnboardingStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
```

**All four steps are present from the first response**, including ones that have not started. You
have the full list to render immediately — a panel that grows a row at a time reads as instability.

### Poll on `running`, not on the list

`running` is taken from the connection's own status. Derive it yourself from the step array and you
will eventually disagree with the server about when to stop. When `running` is `false`, stop
polling; `status` is then `connected` or `error`.

---

## The five statuses, and the one that matters

`skipped` is the one to get right. **It is not a failure and must not render as one.**

Every Meta test number, and every number onboarded through Embedded Signup, is *already registered*
and rejects a second registration because the PIN it holds is not the one being offered. That is a
number which needed no registering, not a broken connection. Treating it as an error made every
test number look broken, which is exactly the false alarm this whole feature exists to avoid.

Render it neutrally — "Already registered" with a tick or a dash, not a warning.

---

## Failure codes → remedies

When a step fails you get a stable `code`. **The remedy copy is yours**, deliberately: wording that
lives in the database cannot be changed without a deployment, and cannot be translated.

| `code` | Meaning | Suggested remedy |
| --- | --- | --- |
| `token_rejected` | The credential was refused — expired or revoked | "Your connection has expired. Reconnect to continue." + reconnect button |
| `subscribe_refused` | Meta refused the webhook subscription | "Meta would not grant access to this account's updates. Check the app has `whatsapp_business_management`, then reconnect." |
| `register_refused` | Registration genuinely failed (not the skip case) | "The number could not be registered. Check it is not connected to another WhatsApp account." |
| `profile_unreadable` | The number or business profile could not be read | "The number was linked but Meta would not return its details. Check the number is verified in Business Manager." |
| `onboarding_failed` | Anything else | Generic, with the `message` behind a "details" toggle |

**Handle an unrecognised code.** Codes will be added over time; an unknown one must fall back to
the generic message rather than render nothing.

`token_rejected` is checked before the step-specific codes because any step can report it and the
remedy is always the same — reconnect. Without that, a token expiring mid-onboarding gets blamed on
whichever call happened to be running.

`message` is operator detail for a support ticket or a details toggle. Do not show it as primary
copy — it is Meta's wording, not ours, and it is not translated.

---

## What a run looks like

Immediately after `POST /connect`:

```jsonc
{
  "status": "pending",
  "onboarding": {
    "running": true,
    "currentStep": "subscribe",
    "steps": [
      { "step": "token",     "status": "succeeded", "completedAt": "..." },
      { "step": "subscribe", "status": "pending",   "completedAt": null },
      { "step": "register",  "status": "pending",   "completedAt": null },
      { "step": "profile",   "status": "pending",   "completedAt": null }
    ]
  }
}
```

A few seconds later, complete:

```jsonc
{
  "status": "connected",
  "onboarding": {
    "running": false,
    "currentStep": null,
    "steps": [
      { "step": "token",     "status": "succeeded" },
      { "step": "subscribe", "status": "succeeded" },
      { "step": "register",  "status": "skipped"   },   // already registered — normal
      { "step": "profile",   "status": "succeeded" }
    ]
  }
}
```

Failed at subscribe:

```jsonc
{
  "status": "error",
  "onboarding": {
    "running": false,
    "currentStep": "subscribe",
    "steps": [
      { "step": "token",     "status": "succeeded" },
      { "step": "subscribe", "status": "failed",
        "code": "subscribe_refused",
        "message": "Meta refused to subscribe this app to the account's updates." },
      { "step": "register",  "status": "pending" },
      { "step": "profile",   "status": "pending" }
    ]
  }
}
```

Note the steps after a failure stay `pending`, not `failed`. They were never attempted, and marking
them failed would tell the administrator four things are broken when one is.

---

## Two behaviours worth knowing

**Retrying is safe.** A step that already succeeded is never re-run — re-registering a number is
actively harmful. If a connection stalls, the poller picks it up again and resumes from the first
unfinished step. So a "retry" button can simply re-issue the connect call.

**Progress survives a restart.** Steps are stored on the connection row, not in memory. The browser
is polling a different process by the time the later steps run, and a deploy mid-onboarding does not
lose what already succeeded.

---

## Still not done — and not code

Meta **business verification is pending** and **app review is in review**. Until both clear, signup
completes only for accounts on the app's roles. Your second point stands unchanged: no real
customer can connect yet, regardless of what either of us builds.

So this feature cannot be exercised end to end today. It can be exercised with a Super Admin using
`connect/manual`, which runs the identical step machinery — that is the honest test available now.

---

## Summary

| Item | Who |
| --- | --- |
| Async connect, returns `pending` immediately | Done — backend |
| Per-step state, persisted and polled | Done — backend |
| Stable failure codes | Done — backend |
| `skipped` for already-registered numbers | Done — backend |
| **Progress panel bound to `onboarding.steps`** | **Yours** |
| **Remedy copy per `code`, with unknown-code fallback** | **Yours** |
| Meta approval | Neither — Meta |
