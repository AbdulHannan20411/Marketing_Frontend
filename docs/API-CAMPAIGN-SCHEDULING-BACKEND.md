# Campaigns & Recurring Schedules — Backend Response

Answer to `API-CAMPAIGN-SCHEDULING.md` and its companion `-BUILD.md`. Read §0 first: it says which
of the shapes below you can call today and which are still being built, so nothing here is
integrated against something that does not exist yet.

Base path: `/api/v1/campaigns`. Response envelope, paging and error shapes are unchanged.

---

## 0. Status — read before integrating

**Everything in this document is now built.** Every endpoint below exists, compiles and is wired to
its permission. The whole feature is code-complete.

| Piece | State |
| --- | --- |
| §1 modelling decision (runs vs aggregate) | **Decided — runs.** Build against §2 |
| Recurrence rule shape | **Built.** Validated on write — §3 |
| Occurrence maths, DST, clamping | **Built.** 17 unit tests — §4 |
| `GET /campaigns/{id}` and new fields | **Built** — §5 |
| `duplicate`, `resume`, `preview-audience` | **Built** — §6 |
| `schedule` accepting `recurrence` | **Built** — §7 |
| `run-now` | **Built** — §8 |
| `GET /{id}/runs` | **Built** — §9 |
| Dispatcher firing recurring campaigns | **Built** — §10 |

### One caveat before you start calling things

The final database migration has **not been applied yet** — it needs the API stopped, which is a
scheduling matter on our side, not a code one. Until it runs, these endpoints will not respond
correctly.

**Ask before you integrate against a live server.** Building models, services and components
against the shapes here is safe to start now; pointing the app at the API and expecting 200s is not,
until you get the word. Nothing in the shapes will change when it lands.

### Order to remove the workarounds

Once the migration is confirmed, in this order:

1. `hydrate()` reverse-matching — §5 gives you `templateId` and `groupIds`
2. The *"saved as a draft"* recurrence fallback — §7
3. The recipient-count "estimate" caveat — §6

Do these one at a time and verify each, rather than stripping all three and finding out which broke.

---

## 1. The decision: a recurring campaign records runs

`Campaign` becomes the **definition**. Each firing becomes a `CampaignRun` with its own counters and
its own status.

- `Campaign.metrics` is now explicitly **lifetime totals across every run**. Label it "All-time
  totals" for a recurring campaign; for a one-off it means what it always meant, so the existing
  "Delivery" label is still right there.
- `Campaign.nextRunAt` and `Campaign.lastRunAt` are new.
- `Campaign.completedAt` stays meaningful only for one-offs. **For a recurring campaign it is
  null** — do not render "Completed 14 Aug" on something that runs again on Monday.

So: build the run history table on the detail page. Roughly the day's work you estimated.

---

## 2. `CampaignRun`

```jsonc
{
  "id": "run_182",
  "campaignId": "cmp_12",
  "occurrenceNumber": 7,
  "status": "completed",
  "triggeredManually": false,
  "scheduledFor": "2026-10-06T08:00:00Z",
  "startedAt": "2026-10-06T08:00:04Z",
  "completedAt": "2026-10-06T08:11:22Z",
  "failureReason": null,
  "metrics": {
    "audienceSize": 1240,
    "sent": 1240,
    "delivered": 1201,
    "read": 902,
    "clicked": 88,
    "failed": 39,
    "skipped": 0
  }
}
```

| Field | Notes |
| --- | --- |
| `id` | Prefixed `run_` |
| `occurrenceNumber` | 1-based, monotonic per campaign. **Counts skipped occurrences**, so the numbering matches the schedule rather than only the sends that happened |
| `status` | `pending` · `running` · `completed` · `failed` · `skipped` |
| `triggeredManually` | `true` for a run started from the **Run now** button — see §8 |
| `scheduledFor` | The instant this occurrence was *due*. For a manual run, the instant it was requested |
| `failureReason` | Set when `failed` or `skipped`. Plain sentence, safe to show |
| `metrics.skipped` | New counter: recipients deliberately not messaged — opted out, over a plan limit, or beyond the messaging tier |

### `skipped` is not a failure

A run with `status: "skipped"` did not go wrong. It is a missed occurrence collapsed by the catch-up
policy (§10) or one with nobody to send to. Style it as neutral, not red — treating it as an error
will have operators chasing incidents that did not happen.

---

## 3. The recurrence rule

Your §2 shape is accepted **exactly as specified**. No field renamed, none added, none dropped.

Three points worth carrying into the UI copy:

**`time` is `HH:mm`.** Sent and returned as `"09:00"`. Not `"09:00:00"` — both parse on the way in,
but what comes back is always `HH:mm`.

**`timeZone` must be an IANA name.** Validated against the IANA database on write; an unrecognised
name is a `422`, never silently defaulted to UTC. `Europe/London`, not `GMT`, not `+01:00`.

**The rule is stored as local date + time + zone and never normalised to UTC.** This is what keeps
"every Monday at 9am" at 9am on both sides of a clock change. It also means `nextRunAt`, which *is*
a UTC instant, will appear to shift by an hour twice a year. That is correct. If you render the next
run, render it in the campaign's `timeZone`, not the browser's, or operators will report a bug that
is not one.

---

## 4. Occurrence rules — three behaviours to reflect in the UI

All three are implemented and unit-tested. Two of them contradict a reasonable guess, so they are
worth a line of copy.

### Short months clamp

`dayOfMonth: 31` fires on the 28th, 29th or 30th rather than skipping the month. Your existing
29–31 warning is exactly right — keep it.

### "Last Friday" means the final one

`ordinal: "last"` resolves to the last matching weekday in the month, which is the fourth in some
months and the fifth in others. It never skips a month for want of a fifth.

### Weekly intervals anchor on the start date's **week**

This one surprises people. `interval: 2`, `weekdays: [1]` (Monday), `startDate: 2026-09-05` (a
Saturday) first fires on **14 September, not the 7th**.

The eligible weeks are the week containing the start date and every second week after it. That first
week's Monday is 31 August, before the start date, so it is not eligible — and the next eligible
week begins on the 13th.

This matches RRULE, and the alternative (re-anchoring on the first matching weekday) would make
"every two weeks" mean different weeks depending on which weekday was ticked. **Suggestion:** when
`interval > 1`, show the computed first occurrence next to the summary sentence — "Repeats every 2
weeks on Monday · first run 14 Sep" — and the surprise disappears.

### Daylight saving

- **The hour that does not exist** (01:30 on a spring-forward morning): fires at the first valid
  instant after the gap, normally 02:00 local. It is not skipped.
- **The hour that happens twice** (01:30 on an autumn morning): fires **once**, on the first pass.

---

## 5. `GET /campaigns/{id}` and the new `Campaign` fields

```jsonc
{
  "id": "cmp_12",
  "name": "Q4 win-back",
  "description": "Re-engage customers who lapsed in Q3",
  "templateName": "winback_v2",
  "templateId": "tpl_18",
  "audienceLabel": "Lapsed · High value",
  "groupIds": ["grp_2", "grp_5"],
  "status": "scheduled",
  "metrics": { "audienceSize": 1240, "sent": 8470, "delivered": 8201,
               "read": 6102, "clicked": 540, "failed": 269 },
  "recurrence": { "frequency": "weekly", "interval": 1, "weekdays": [1], "…": "…" },
  "timeZone": "Europe/London",
  "scheduledAt": null,
  "nextRunAt": "2026-10-13T08:00:00Z",
  "lastRunAt": "2026-10-06T08:00:00Z",
  "occurrencesRun": 7,
  "completedAt": null,
  "createdBy": "Sara Khan",
  "createdAt": "2026-08-20T09:14:00Z",
  "updatedAt": "2026-09-02T11:40:00Z"
}
```

`templateId` and `groupIds` are now authoritative. **Delete the reverse-matching in `hydrate()`** —
template by name and groups by label substring — once this ships. That is the fragile path you
flagged, and it is the one that picks the wrong group when two share a word.

`recurrence` is `null` for a one-off. `scheduledAt` is `null` for a recurring campaign. They are
mutually exclusive; a campaign is one or the other.

**Sending fields on write:** `description` and `recurrence` are accepted on `POST /campaigns` and
`PUT /campaigns/{id}`. `groupIds` already was.

---

## 6. Duplicate, resume, preview-audience

**`POST /campaigns/{id}/duplicate`** → the new campaign, exactly as you specified: status `draft`,
counters zeroed, `scheduledAt`, `nextRunAt`, `lastRunAt` and `completedAt` cleared, `occurrencesRun`
reset to 0, name suffixed `(copy)`. **The recurrence rule is copied** — duplicating a weekly campaign
gives you a weekly draft, not a one-off.

**`POST /campaigns/{id}/resume`** → back to `scheduled` if it has a schedule (either
`scheduledAt` or a recurrence), `draft` if it does not. `409 campaign_not_paused` otherwise.
On resume, `nextRunAt` is **recomputed from now**, not restored — a campaign paused for three weeks
does not wake up owing three sends.

**`POST /campaigns/preview-audience`** → `{ "recipientCount": 1187 }` from
`{ "groupIds": ["grp_2", "grp_5"] }`. Deduplicated and opt-out aware. **Drop the "estimate"
caveat** once you switch to it; this is the real number.

---

## 7. Scheduling with a recurrence

```
POST /campaigns/{id}/schedule
```

Both forms are accepted, and you may keep sending both as you do now:

```jsonc
{ "recurrence": { "frequency": "weekly", "…": "…" } }   // recurring
{ "scheduledAt": "2026-09-05T08:00:00Z" }               // one-off
```

**Precedence:** if `recurrence` is present and its `frequency` is not `once`, the recurrence wins
and `scheduledAt` is ignored. If `frequency` is `once`, the rule's own `startDate` + `time` +
`timeZone` are used and `scheduledAt` is ignored — the rule is the more precise statement of intent,
because it carries the zone.

The response carries `nextRunAt` already computed, so you can confirm the first firing to the
operator without a second call.

**Once this ships, remove** the *"Recurring schedules are not yet accepted by the API, so it is
saved as a draft"* path.

Errors: `422` for a rule that fails validation (field-level, as usual — `recurrence.weekdays`,
`recurrence.timeZone` and so on), `409 template_not_approved` as today.

---

## 8. Run now

```
POST /campaigns/{id}/run-now
Idempotency-Key: <uuid>
```

Fires a scheduled campaign immediately **without disturbing its schedule**. A campaign set for
Monday can be run today, and it still runs on Monday.

Returns the created **run** (§2), not the campaign, so you can prepend it to the history table
without refetching.

| Rule | Behaviour |
| --- | --- |
| `nextRunAt` | **Unchanged.** Monday is still Monday |
| `occurrencesRun` | **Not incremented.** A manual run does not consume an `afterCount` allowance |
| `occurrenceNumber` | Still allocated from the sequence, so the run is ordered correctly in history |
| `triggeredManually` | `true` — badge it in the table, so an unexpected send is explainable later |
| Campaign `status` | Stays `scheduled`. It does **not** become `sending` |

**Allowed from `scheduled` only.** Anything else returns `409 campaign_not_scheduled`. A draft is
sent with the existing `POST /{id}/send`; a paused campaign must be resumed first.

**Double-click safety:** if a run for this campaign is already `pending` or `running`, that run is
returned rather than a second one created. The button is safe to leave enabled, but disable it while
the request is in flight anyway.

### Suggested placement

On the detail page next to the schedule summary — *"Next run Monday 13 Oct, 9:00 AM"* with a
secondary **Run now** button. **Confirm before firing.** This sends real messages to the full
audience and cannot be recalled; it deserves the same confirmation as Send.

Worth putting in the confirm dialog: the recipient count, and that the schedule is unaffected.

---

## 9. Run history

```
GET /campaigns/{id}/runs?page=1&pageSize=20
```

Standard paged envelope, **newest first**. Items are §2.

For the table: `scheduledFor` in the campaign's timezone, `status`, `triggeredManually` as a badge,
then sent / delivered / read / failed. A `failed` or `skipped` run should show its `failureReason` —
it is written to be read by an operator.

---

## 10. What the dispatcher guarantees

Useful for the copy you write, and for what you can promise an operator.

**It will not send twice.** Each occurrence is claimed by a unique `(campaignId, occurrenceNumber)`
row written inside the transaction *before* any message goes out, and each recipient by a unique
`(runId, contactId)`. A crash mid-run resumes without re-sending what it already claimed.

**The audience is resolved at fire time**, not at save time — deduplicated across groups, and
opt-outs are honoured on the day. A weekly campaign to "New customers" reaches the people who are
new that week.

**Catch-up after downtime fires the most recent missed occurrence and skips the rest**, recording
the skipped ones as runs with `status: "skipped"`. Six hours of downtime on an hourly campaign
produces one send and five skipped runs, not six identical messages.

**Long-lived campaigns pause rather than fail.** Re-checked at every firing: template still
approved, WhatsApp still connected, groups still exist, plan limits, messaging tier. If one fails
the campaign moves to `paused` with a reason, not `failed` — paused is fixable, failed usually means
someone rebuilds it from scratch. **So `paused` can now appear without a human having pressed
Pause.** Show the reason on the detail page and make Resume the obvious next action.

### Where to read the pause reason

**The reason is on the run, not on the campaign.** When a campaign auto-pauses, a run is recorded
with `status: "skipped"` and the explanation in its `failureReason`:

> *"winback_v2 is paused at Meta and cannot be sent. Fix the template, then resume the campaign."*

So on a `paused` campaign, read the newest run from `GET /{id}/runs` and surface its
`failureReason`. If the newest run is `completed`, a person pressed Pause and there is nothing to
explain.

---

## 10a. Four things that emerged while building this

Not in the original spec, and each one is visible in the UI.

**One-off campaigns get runs too.** Every dispatch now opens a run, so the history table is
populated for one-offs as well as recurring campaigns — exactly one row. Build the table for both
rather than hiding it when `recurrence` is null; a one-off with one run reads perfectly well.

**`occurrencesRun` counts scheduled firings only.** A **Run now** does not increment it, so an
"after 12 occurrences" campaign still gets its 12 scheduled sends however many extra runs an
operator triggers. If you show progress against `occurrenceCount`, use this field — do not count
rows in the run history, which includes manual and skipped runs.

**`skipped` runs appear in normal operation.** Both from the catch-up policy and from a blocked
occurrence. They are not errors — style them neutrally. A campaign can accumulate several skipped
runs and still be perfectly healthy.

**Resume recomputes rather than restores.** Resuming a recurring campaign sets `nextRunAt` from now,
so it does not fire immediately for occurrences missed while paused. If a rule has no future
occurrences left at that point, the campaign resumes straight to `completed` rather than to
`scheduled` — handle that transition, since the user pressed Resume and will not expect it.

---

## 11. Checklist

- [ ] Run history table on the detail page — **for one-off campaigns too** (§2, §9, §10a)
- [ ] Label `Campaign.metrics` "All-time totals" when `recurrence` is set (§1)
- [ ] Suppress `completedAt` for recurring campaigns (§1)
- [ ] Render `nextRunAt` in the campaign's `timeZone`, not the browser's (§3)
- [ ] Show the computed first occurrence when `interval > 1` (§4)
- [ ] Delete the name/label reverse-matching in `hydrate()` (§5)
- [ ] Switch the wizard to `preview-audience`, drop the estimate caveat (§6)
- [ ] Remove the "saved as a draft" fallback (§7)
- [ ] **Run now** button with confirmation (§8)
- [ ] Handle `paused` arriving without user action; read the reason off the newest run (§10)
- [ ] Style `skipped` runs neutrally, not as errors (§10a)
- [ ] Badge `triggeredManually` runs in the history table (§2, §8)
- [ ] Show `afterCount` progress from `occurrencesRun`, not from run-history length (§10a)
- [ ] Handle Resume landing on `completed` when a rule has run out (§10a)

## 12. Error codes

| Code | Status | When |
| --- | --- | --- |
| `template_not_approved` | 409 | Existing |
| `campaign_not_pausable` | 409 | Existing |
| `campaign_not_paused` | 409 | Resume on a campaign that is not paused |
| `campaign_not_scheduled` | 409 | **New.** Run now on a campaign that is not scheduled |
| `invalid_campaign_transition` | 409 | Existing |
| — | 422 | Recurrence validation, field-level under `recurrence.*` |
