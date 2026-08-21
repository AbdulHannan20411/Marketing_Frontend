# Campaigns & Recurring Schedules — Integration Status

The front end is built against the contract in `API-CAMPAIGN-SCHEDULING-BACKEND.md` and needs no
further changes to consume it. This document records what is wired, what happens while an endpoint
is still 404ing, and the two places the UI deviates from the brief on purpose.

Base path: `/api/v1/campaigns`.

> **Companions:** `-BACKEND.md` is the wire contract as delivered — it is the authority.
> `-BUILD.md` was the original request for it and is kept for the reasoning behind the modelling
> decision (runs vs. lifetime aggregate), which was answered: **runs**.

---

## 1. Every endpoint the UI calls

| Method | Path | State | What the UI does while it 404s |
| --- | --- | --- | --- |
| GET | `/campaigns` | Live | — |
| POST | `/campaigns` | Live | — |
| PUT | `/campaigns/{id}` | Live | — |
| DELETE | `/campaigns/{id}` | Live | — |
| POST | `/campaigns/{id}/send` · `/pause` · `/cancel` | Live | — |
| GET | `/campaigns/{id}` | Building | Falls back to finding the campaign in the list |
| POST | `/campaigns/{id}/schedule` with `recurrence` | Building | Attempts it; on failure saves as a draft and says so |
| POST | `/campaigns/{id}/resume` | Building | Surfaces the error in a toast — not faked |
| POST | `/campaigns/{id}/duplicate` | Building | Surfaces the error in a toast — not faked |
| POST | `/campaigns/preview-audience` | Building | Falls back to summing group counts, labelled an estimate |
| GET | `/campaigns/{id}/runs` | Building | Run history section stays hidden |
| POST | `/campaigns/{id}/run-now` | Building | Surfaces the error in a toast |

Every fallback resolves itself the moment the endpoint answers — none of them needs code removed.
The two exceptions, which **do** need deleting once their endpoints are live, are listed in §5.

### The migration has not been applied yet

The backend reports the feature **code-complete**, with the final database migration still pending —
it needs the API stopped. Probing the running server on 20 August 2026 confirms the deployed build
predates the change: `GET /auth/me` and `GET /campaigns` return **200**, and all six new endpoints
do not answer.

```
GET  /campaigns/{id}              405   ← matches the PUT/DELETE route template, not the method
POST /campaigns/preview-audience  405   ← captured by /campaigns/{id} with id="preview-audience"
GET  /campaigns/{id}/runs         404
POST /campaigns/{id}/run-now      404
POST /campaigns/{id}/resume       404
POST /campaigns/{id}/duplicate    404
```

The client treats **404, 405 and 501 alike** as "not built yet" rather than as failures — see
`NOT_IMPLEMENTED_YET` in `campaign-detail.component.ts`. So the app can point at the live API today
and degrade honestly; it simply will not show the new capabilities until the migration lands.

**One thing for the backend:** `preview-audience` is a literal segment competing with the `{id}`
parameter, which is why it answers 405 rather than 404. Register it **before** the `{id}` route, or
ASP.NET will bind `id = "preview-audience"` and the endpoint will never be reached even once it is
deployed.

---

## 2. Two deliberate deviations from the brief

**Send now is hidden on a recurring campaign.** §6 of the original brief allows Send from
`scheduled`. But `send` moves the campaign to `sending` and consumes the schedule, while `run-now`
leaves it intact — and side by side the two buttons look interchangeable. A recurring campaign is
therefore offered **Run now only**; a one-off keeps Send. `canSend()` in
`campaign-detail.component.ts` carries the reasoning.

**The wizard shows the first occurrence when it is not the start date.** Answering the backend's
§4 note: a rule of "every 2 weeks on Monday" starting Saturday 5 September first fires on the
**14th**, not the 7th, because weekly intervals anchor on the start date's own week. The schedule
step, the review step and the confirmation dialog all say *"First run September 14, 2026"* rather
than leaving the operator to work it out.

---

## 3. Where the contract is implemented

| Piece | File |
| --- | --- |
| Recurrence rule, validation, human summary, first-occurrence maths | `core/models/recurrence.model.ts` |
| `CampaignRun`, run statuses, the new `Campaign` fields | `core/models/campaign.model.ts` |
| Every call, each documented with its state | `core/services/campaigns.service.ts` |
| Reusable scheduler | `shared/ui/recurrence-editor/` |
| Create / edit wizard | `features/campaigns/campaign-form/` |
| Detail, run history, lifecycle actions | `features/campaigns/campaign-detail/` |
| List, search, filter, row actions | `features/campaigns/campaigns.component.*` |

Routes: `/campaigns`, `/campaigns/new`, `/campaigns/:id`, `/campaigns/:id/edit`, mirrored under
`/superadmin/…` behind the scope guard.

`formatInstant(instant, timeZone)` renders `nextRunAt`, `lastRunAt` and `scheduledFor` in the
**campaign's** zone rather than the browser's — a campaign set for 9am in Europe/London reads as
9am to an operator sitting in Karachi.

---

## 4. The backend's §11 checklist

- [x] Run history table on the detail page — **including one-off campaigns**, which get one run each
- [x] `Campaign.metrics` labelled "All-time totals" when the campaign recurs
- [x] `completedAt` suppressed for a recurring campaign
- [x] `nextRunAt` rendered in the campaign's `timeZone`
- [x] Computed first occurrence shown when `interval > 1`
- [x] `preview-audience` used, with the estimate caveat dropped when it answers
- [x] **Run now** with a confirmation naming the recipient count and stating the schedule is unaffected
- [x] `paused` handled without user action — **the reason is read off the newest run**, not off the campaign
- [x] `skipped` runs styled neutral, not red, with their `failureReason` shown
- [x] `triggeredManually` runs badged **Manual** in the history table
- [x] `afterCount` progress taken from `occurrencesRun`, never from run-history length
- [x] Resume landing on `completed` handled, and said plainly rather than left to the badge
- [ ] Name/label reverse-matching deleted from `hydrate()` — waiting on the migration
- [ ] "Saved as a draft" fallback removed — waiting on the migration

### Corrections made against the revised contract

**The pause reason is not a campaign field.** It is the `failureReason` of the newest run, which is
recorded as `skipped` when an occurrence cannot go out. The speculative `Campaign.pauseReason` has
been removed from the model — the comment left in its place says where the reason actually lives, so
nobody re-adds it. A newest run that `completed` means a person pressed Pause, and no banner shows.

**One-offs get run histories too.** The table renders for every campaign rather than only recurring
ones, and a one-off shows its single row.

**`occurrencesRun` is the only source for `afterCount` progress.** Counting run-history rows would
include manual and skipped runs and overstate it — telling an operator a campaign is finished when
it has sends left.

## 5. The two things to delete when their endpoints land

**When `GET /campaigns/{id}` returns `templateId` and `groupIds` (§5):** remove
`templateIdByName()` and `groupIdsByLabel()` from `campaign-form.component.ts`. They match the
template by name and the groups by substring of the audience label, and the substring match picks
the wrong group when two share a word. They already run only when the ids are absent, so deleting
them is a straight subtraction.

**When `schedule` accepts `recurrence` (§7):** remove the *"Recurring schedules may not be accepted
yet — the campaign is saved as a draft"* branch in `scheduleAfterSave()`. The success path is
already correct and already runs; only the error copy is provisional.

**Do these one at a time**, in the order the backend asked for — `hydrate()` first, then the draft
fallback, then the estimate caveat — verifying each before starting the next, rather than stripping
all three and then working out which one broke.

---

## 6. Verified

Against the in-memory mock, which enforces the same rules the API states — including
`409 campaign_not_scheduled` on Run now, distinct opt-out-aware audience counts, and a `skipped`
run in the seeded history so its neutral styling is actually exercised:

- Weekly, every 2 weeks, on Monday, starting Saturday 5 Sep 2026 → **first run 14 September** in the
  schedule step, the review and the confirmation; the campaign lands with `nextRunAt` on the 14th.
- Recipient count is `55`, not the `73` the group totals sum to, and the "estimate" caveat is gone
  — the same 55 carries through the review, the confirmation and the detail page.
- Run now prepends a **Manual** badged run and leaves *"Next run Aug 24, 9:00 AM"* untouched.
- Lifetime totals reconcile against the run history (4 completed runs × 1,810 = 7,240 sent).
- An auto-paused campaign shows its reason with Resume beside it; resuming clears the banner.
- Every run time renders in the campaign's zone and agrees with the schedule sentence above it.

`firstOccurrenceDate()` was checked against 16 cases covering weekly anchoring, short-month
clamping (31st → 30 September), `last`-weekday resolution, `ordinal` weekdays, multi-month and
multi-year intervals, and 29 February clamping to the 28th.

To exercise it without a backend, set `useMockApi: true` in `web/src/environments/environment.ts`.
