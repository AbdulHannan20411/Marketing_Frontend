# Recurring Campaigns — Implementation Notes

Companion to `API-CAMPAIGN-SCHEDULING.md`, which is the wire contract. This one covers the parts
that document does not: how a recurring campaign actually fires, what has to be stored, and the
failure modes that will otherwise be discovered in production.

Read §1 first — it is a modelling decision that changes the API shape, and the front end is waiting
on the answer.

---

## 1. The question that needs deciding first

**A recurring campaign is not one send. It is many.**

Today `Campaign` carries a single `metrics` object and a single `completedAt`:

```jsonc
{ "metrics": { "sent": 4210, "delivered": 4102, "read": 3180, "failed": 12 },
  "completedAt": "2026-08-14T09:04:00Z" }
```

For a one-off that is exact. For "every Monday at 9am", it is ambiguous — is that last Monday, or
every Monday since September? The two readings give very different numbers, and an operator reading
"4,210 sent" cannot tell which they are looking at.

**The recommendation: introduce a run.** A campaign becomes the *definition*; each firing becomes a
`CampaignRun` with its own counters and its own status.

```jsonc
// GET /campaigns/{id}/runs?page&pageSize   — newest first
{
  "id": "run_182",
  "campaignId": "cmp_12",
  "occurrenceNumber": 7,
  "status": "completed",
  "scheduledFor": "2026-10-06T08:00:00Z",
  "startedAt": "2026-10-06T08:00:04Z",
  "completedAt": "2026-10-06T08:11:22Z",
  "metrics": { "audienceSize": 1240, "sent": 1240, "delivered": 1201, "read": 902, "clicked": 88, "failed": 39 }
}
```

`Campaign.metrics` then becomes the **lifetime total across runs**, and the campaign carries
`nextRunAt` and `lastRunAt`. Both readings are available and neither is guessable.

**What the front end does today:** shows the single `metrics` object as-is and labels it "Delivery".
That is correct for one-off campaigns and misleading for recurring ones. I have not invented a runs
UI, because guessing the shape would mean rebuilding it. **Tell me which way you go:**

- **Runs added** → I build a run history table on the detail page, with per-run metrics and a
  "next run" indicator. Roughly a day's work.
- **Aggregate only** → I label the metrics "All-time totals" and add `nextRunAt` to the detail page.
  An hour.

Either is fine. Silence is the bad outcome, because the current screen will quietly mean the wrong
thing the day recurrence ships.

---

## 2. Firing a schedule

### Compute, do not enumerate

Do not pre-generate every occurrence to the end of time — an `endCondition: "never"` campaign has no
end, and a stored list drifts the moment the rule is edited. Store the rule, compute
`nextRunAt` after each firing, and index on it:

```
SELECT * FROM Campaigns
WHERE Status = 'scheduled' AND NextRunAt <= @now
```

A minute-cadence job over that index is enough; it is the same cadence the existing dispatcher uses.

### Computing the next occurrence

Work **in the campaign's timezone**, then convert to UTC once for storage:

1. Take `startDate` + `time` in `timeZone` as the anchor.
2. Advance by `frequency` × `interval` until the result is after "now".
3. For `weekly`, expand to the selected `weekdays` and take the earliest future one.
4. For `monthly` in `dayOfWeek` mode, resolve `ordinal` + `ordinalWeekday` within the target month —
   `last` means the final matching weekday, not the fifth.
5. For `monthly`/`yearly` in `dayOfMonth` mode, **clamp to the last day of a short month**.
   The UI already warns the operator that day 29–31 behaves this way; honour that promise.
6. Stop if `endCondition` is met — `endDate` passed, or `occurrenceCount` runs reached.

A library beats hand-rolling this. `TimeZoneInfo` plus `NodaTime` is the usual .NET answer; if the
scheduler already has an RRULE engine, map our flat rule onto it at the boundary rather than
adopting RRULE in the API.

### DST — the part that bites

`Europe/London`, 9:00 local, across the spring transition:

- Store UTC only and the campaign fires at 08:00 local all summer. Wrong.
- Recompute from local + zone each time and it fires at 09:00 year round. Correct.

Two specific cases to handle rather than crash on:

- **The hour that does not exist.** 01:30 on a spring-forward morning. Convention: fire at the start
  of the next valid hour.
- **The hour that happens twice.** 01:30 on an autumn morning. Convention: fire once, on the first
  occurrence. Guard with the idempotency key below, or it sends twice.

---

## 3. Not sending twice

This is the failure that costs money and trust, and it is the one most likely to happen.

**Unique key per occurrence.** `(CampaignId, OccurrenceNumber)` or
`(CampaignId, ScheduledForUtc)` with a unique constraint. Claim the row *before* dispatching, inside
the transaction — not after. A worker that crashes mid-send then resumes without re-sending what it
already claimed.

Redelivery, two workers polling the same minute, a retry after a timeout: all of these will happen.
The constraint is what makes them harmless.

**Catch-up after downtime.** If the service is down for six hours, a daily campaign has one missed
occurrence and an hourly one has six. Do not blindly fire all of them — the customer gets six
identical messages. Decide a policy and write it down; the usual choice is to fire the most recent
missed occurrence and skip the rest, with the skip recorded on the run.

---

## 4. Checks at fire time, not only at save time

A campaign scheduled in September and firing in December can fail for reasons that did not exist
when it was created. Re-check at each firing:

| Check | If it fails |
| --- | --- |
| Template still `approved` | Pause the campaign, record the reason, notify. Meta pauses templates on poor feedback |
| WhatsApp still connected | Pause; nothing can send |
| Groups still exist and are non-empty | Record a run with `audienceSize: 0` rather than erroring |
| Plan contact/message limits | Send what fits, record the rest as skipped — the import flow already sets this precedent |
| Messaging tier / rate limits | Throttle within the run; do not fail it |

**Pausing beats failing.** A paused campaign can be fixed and resumed; a failed one usually means
someone rebuilds it from scratch.

---

## 5. Audience resolution

Resolve group membership **at fire time**, not at save time. A weekly campaign to "New customers"
should reach the people who are new that week — resolving once at save would freeze the audience on
day one, which is the opposite of what a recurring campaign is for.

Deduplicate across groups. The UI shows a sum and openly calls it an estimate precisely because it
cannot; the run's `audienceSize` should be the real distinct count.

Respect opt-outs at fire time too. A contact who unsubscribed in October must not receive November's
send, whatever the group says.

---

## 6. Persistence sketch

Not prescriptive — these are the fields the contract requires you to be able to answer.

```
Campaign         Id, TenantId, Name, Description, TemplateId, AudienceLabel,
                 Status, CreatedBy, CreatedAt, UpdatedAt,
                 ScheduledAt?            -- one-off, existing
                 RecurrenceJson?         -- the rule from §2 of the contract
                 TimeZone                -- denormalised for the query above
                 NextRunAtUtc?           -- indexed; the dispatcher's entry point
                 LastRunAtUtc?
                 OccurrencesRun          -- for endCondition: afterCount

CampaignGroup    CampaignId, GroupId     -- unique (CampaignId, GroupId)

CampaignRun      Id, TenantId, CampaignId, OccurrenceNumber, Status,
                 ScheduledForUtc, StartedAt?, CompletedAt?, FailureReason?,
                 AudienceSize, Sent, Delivered, Read, Clicked, Failed, Skipped
                 unique (CampaignId, OccurrenceNumber)

CampaignRecipient  RunId, ContactId, Status, MetaMessageId?, FailureReason?
                 unique (RunId, ContactId)     -- the per-contact idempotency guard
```

`TenantId` on every table; the existing global query filter applies. `CampaignRecipient` is what
lets a crashed run resume without re-sending, and what delivery receipts are matched against.

---

## 7. Suggested order of work

Each step leaves something usable, which matters because the UI is already shipped and currently
degrades honestly rather than breaking.

| # | Work | Unlocks |
| --- | --- | --- |
| 1 | `GET /campaigns/{id}` | Detail and edit stop reading the whole list |
| 2 | `templateId`, `groupIds`, `description`, `updatedAt` on `Campaign` | Editing stops guessing by name |
| 3 | `POST /{id}/duplicate`, `POST /{id}/resume` | Two buttons that 404 today |
| 4 | Persist `recurrence` on schedule; return it on read | Schedules survive a reload |
| 5 | Next-occurrence computation + `NextRunAt` | Recurring campaigns can be queried |
| 6 | Dispatcher fires on `NextRunAt`, with the idempotency key | **Recurring campaigns actually send** |
| 7 | `CampaignRun` + `GET /{id}/runs` (if §1 says runs) | Per-run history |
| 8 | Fire-time re-checks from §4 | Long-lived campaigns fail safely |

Steps 1–3 are small and unblock the editor immediately. Step 6 is the feature.

---

## 8. What the front end does while this is missing

Stated plainly so nothing looks broken in the meantime:

- A **recurring** schedule saves as a draft and says: *"Recurring schedules are not yet accepted by
  the API, so it is saved as a draft."*
- A **one-off** schedule works today through the existing `scheduledAt` path.
- **Duplicate** and **Resume** call their endpoints and surface the 404 through the normal error
  toast — they are not faked.
- **Editing** rehydrates the template by name and groups by substring of the audience label, and
  will pick the wrong group when two share a word. This is isolated to `hydrate()` in
  `campaign-form.component.ts` with a comment; step 2 above removes it.
- **Recipient counts** are labelled estimates because groups may overlap.
