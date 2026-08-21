# Onboarding State — Persisting the Product Tour

One small endpoint pair. The front end works today without it; adding it makes a user's tour state
follow them between devices instead of living in one browser.

Base path: `/api/v1/auth`.

---

## 0. Status — built, awaiting migration

| Method | Path | State |
| --- | --- | --- |
| GET | `/auth/me/onboarding` | **Built.** Columns not yet migrated |
| PUT | `/auth/me/onboarding` | **Built.** Columns not yet migrated |

Both are written to this shape exactly. The migration adding the columns has **not** been applied,
so both fail today.

**`useApi` in `core/services/onboarding-store.service.ts` is deliberately still `false`,** and stays
that way until the backend confirms the migration has run. Nothing about the shape changes when it
does — flipping the flag is the whole switch.

**The `localStorage` path stays afterwards**, as the `catchError` fallback rather than the primary.
It costs nothing, and it means a first-run tour still works for someone offline or behind a failing
request — the one moment a new user is least forgiving of a broken screen.

---

## 1. The shape

```jsonc
{
  "status": "in_progress",              // not_started | in_progress | completed | skipped
  "stepIndex": 2,                       // 0-based; where an interrupted run had got to
  "updatedAt": "2026-08-21T08:24:02.993Z"
}
```

| Field | Notes |
| --- | --- |
| `status` | The four states. `not_started` is also the correct answer for a user who has no row |
| `stepIndex` | 0-based. Lets a refresh mid-tour resume where it stopped rather than restarting |
| `updatedAt` | Server-set on write; **null** until there is something to stamp. Ignored on the way in |

### `GET /auth/me/onboarding`

Returns the above. **A user who has never been seen returns `not_started` with `stepIndex: 0` and
`updatedAt: null`, not a 404** — "no row" and "not started" are the same thing, and a 404 would make
every first login look like an error in the logs.

`updatedAt` is therefore **nullable**, and `OnboardingState.updatedAt` is typed `string | null` to
match. Anything rendering it has to handle the null; nothing does today.

### `PUT /auth/me/onboarding`

Takes the same shape, returns the stored result. Idempotent; last write wins. The client writes on
every step change, so expect roughly one call per step — a handful per user, once.

`updatedAt` on the way in is ignored server-side and the response carries the server's clock. The
client keeps sending it because the same object is what it stores locally, and stripping it would
mean two shapes for one thing.

**A negative `stepIndex` is clamped to 0 rather than refused**, which is right: refusing would throw
away the `status` alongside the bad index. The client clamps at both ends too — on read from local
storage, and again when resuming — because a negative index would select no step and leave the tour
active with nothing to show, dimming the app with no way out but Escape. Verified by seeding
`stepIndex: -3` and confirming the tour resumes at step 1 and writes the corrected index back.

---

## 2. Scoping

Resolved **entirely from the JWT**, like `PATCH /auth/me`. No id in the path or body, and the
endpoint must never accept one: this is per-user state, and taking an id would let anyone reset
anyone else's tour.

Per **user**, not per tenant — two employees in the same workspace each see it once.

No permission beyond being authenticated.

---

## 3. Why `stepIndex` and not just a boolean

A boolean would answer "has this user seen the tour". It would not let an interrupted run resume,
which is the difference between closing the tab at step 3 and coming back to step 3, versus coming
back to step 1 and skipping out of irritation.

It is deliberately an **index, not a step id**. The step list is derived from the user's own
navigation, so it changes when their permissions or plan change. An index degrades safely — it is
clamped to the new length — where a stored id could name a step that no longer exists for them.

---

## 4. What the front end does

| Piece | File |
| --- | --- |
| State and step types | `core/models/onboarding.model.ts` |
| Tour copy, in order | `core/config/onboarding.config.ts` |
| Persistence — **the only place storage is touched** | `core/services/onboarding-store.service.ts` |
| Step derivation, navigation, skip/complete/restart | `core/services/onboarding.service.ts` |
| Overlay, spotlight, tooltip, progress | `shared/ui/product-tour/` |

**Steps are derived from the sidebar, not declared.** `LayoutService.visibleNavigation` already
filters navigation by permission, role, plan module and workspace lock; the tour intersects the copy
in `onboarding.config.ts` with the routes that survive. So an admin sees 10 steps and an employee
sees 7, without either number being written down anywhere — and a user can never be shown a step for
a tab they cannot open.

Adding a step is one entry in `onboarding.config.ts`. Nothing else changes.

---

## 5. Verified

Against the mock, admin and employee accounts:

- **Admin first login** → tour starts automatically at "Step 1 of 10", walks Dashboard → Contacts →
  Groups → WhatsApp → Templates → Campaigns → Inbox → Reports → Employees → Settings, navigating to
  each route and re-anchoring the spotlight on the right sidebar item.
- **Employee first login** → "Step 1 of 7" from the same config, because their sidebar has seven of
  those routes. No Groups, Inbox or Employees steps. (It was 6 before Settings was un-gated — the
  count follows the sidebar, which is the point.)
- **Finish** writes `completed`; reloading does not show the tour again.
- **Skip** asks for confirmation, "Continue tutorial" resumes, "Skip" writes `skipped`.
- **State is per user** — `vd.onboarding.1` and `vd.onboarding.2` are independent, so an admin
  completing the tour does not suppress it for an employee on the same browser.
- **Refresh mid-tour** resumes at the same step and navigates back to that route.
- **Restart** from Settings → Help & FAQ → Product tour resets and relaunches from step 1.
- **A missing target is skipped**, not fatal: removing a step's element from the DOM made the tour
  wait, give up, and continue to the next step with the app intact.
- **A corrupt stored index recovers**: seeding `stepIndex: -3` resumes at step 1 and writes the
  clamped value back, rather than leaving the tour active with no step to render.
- **Escape** opens the skip confirmation from anywhere, including after clicking the dimmed area;
  **←/→** move between steps.
- **Mobile (375 px)** opens the nav drawer so the targets exist, and the page does not scroll
  horizontally.

### One thing that changed outside the tour — confirmed safe

`Settings` was hidden from the sidebar behind `settings.company`, while its **route has never had a
guard** — so employees could reach the page by typing the URL but had no link to it. That left them
unable to edit their own profile or restart the tour.

The nav item is no longer permission-gated, which brings the sidebar in line with what the route
already allowed.

**The backend confirmed this opens nothing.** `settings.company` gates no endpoint — it is in the
permission catalogue and referenced by nothing, because there is no company-settings endpoint yet.
Everything reachable from Settings is gated by its own permission and enforced at the API:
subscription by `settings.subscription`, billing by `settings.billing`, profile and tour by being
authenticated. An employee who opens Settings sees the personal parts and gets a 403 from anything
else.

**The rule to keep:** if genuinely company-level content is added to this page later, gate it
*inside* the page and gate its endpoint server-side. Hiding a nav entry is tidiness, never a
security boundary.

One loose end, harmless but worth knowing: `settings.company` is still grantable to an employee
through the Employees screen, where it now controls nothing at all. Worth either wiring it to real
company settings or dropping it from the catalogue, whichever comes first.
