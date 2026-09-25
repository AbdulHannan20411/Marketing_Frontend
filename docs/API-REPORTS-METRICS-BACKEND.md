# Reports — The Headline Rates Are Always Zero

The Reports page shows **0.0% delivery, 0.0% read, 0.0% click-through and 0.00% failure**, with a
flat trend line and an empty funnel — directly above a failure log listing real failures from five
days ago (4 × "the number of template variables does not match", 1 × `Graph API returned 400. Code
131037`).

The two halves of that page disagree, and the failure log is the half with evidence in it.

---

## 1. Where the numbers come from

| Panel | Source |
| --- | --- |
| The four rates, the trend, the funnel | `MessageDailyStat` (`AnalyticsService.BuildKpis/BuildTrend/BuildFunnel`) |
| The failure log and the breakdown | `DeliveryFailure` rows |

`MessageDailyStat` is written in exactly one place:

```
WhatsAppWebhookService.ProcessStatusesAsync → RecordDailyStatAsync   (line ~185)
```

`CampaignDispatchService` never touches it. On a successful send it does:

```csharp
message.Status = CampaignMessageStatus.Sent;   // ~line 604
message.SentOn  = _clock.UtcNow;
campaign.SentCount++;
```

and on a rejected one:

```csharp
message.Status = CampaignMessageStatus.Failed; // ~line 630
campaign.FailedCount++;
RecordFailure(campaign, message, reason);      // the row the Reports page shows
```

Neither increments the daily counters. So:

- **A send Meta rejects outright can never be counted.** Code 131037 means Meta refused the
  message; there is no message id, so no `sent`, `delivered` or `failed` webhook will ever arrive
  for it. Those five failures cannot reach `MessageDailyStat` through the only path that writes to
  it. That is the direct cause of "0.00% failure rate" above a list of failures.
- **Nothing is counted at all without a public webhook.** In an environment where Meta cannot reach
  `/webhooks/whatsapp` — local development, most obviously — every counter stays at zero forever,
  which is the rest of the screenshot.

The campaign's own `SentCount` and `FailedCount` are correct throughout. The reporting table is the
one that is empty.

---

## 2. The ask

### a. Count a send where the send happens

In `CampaignDispatchService`, where `message.Status` is set to `Sent`, increment that day's `Sent`.
The same `RecordDailyStatAsync` shape already exists in the webhook service — worth lifting into a
small `IMessageStatsRecorder` both call, so there is one upsert and one place that knows the table.

### b. Count a rejection where the rejection happens

In `RecordFailure`, increment that day's `Failed` alongside the `DeliveryFailure` row — they are the
same event and should not be able to disagree.

`AbandonAsync` is the one to leave alone: a campaign abandoned before sending writes a
`DeliveryFailure` with no `CampaignMessage` behind it. It is a campaign that failed, not a message
that did, and counting it as a failed message would make the rate wrong in the other direction.

### c. Then stop the webhook double-counting `Sent`

Once (a) is in, the `sent` receipt must no longer increment `Sent`, or every message is counted
twice. `Delivered`, `Read` and webhook-reported `Failed` stay exactly as they are. `ShouldAdvance`
already makes replayed receipts harmless, which is the property to preserve.

The increment belongs in the same `SaveChanges` as the status change, so a retry cannot leave a
counter ahead of the messages it counts.

### d. One-off backfill

Existing data is recoverable without Meta: `CampaignMessage` has `SentOn` and `Status`, and
`DeliveryFailure` has `OccurredOn`. A small script can rebuild `MessageDailyStat` for the last 60
days so the page is not empty for everything that has already happened.

---

## 3. Click-through is a separate question

`MessageDailyStat.Clicked` is read by the funnel and by the click-through tile, and **nothing in the
codebase ever increments it** — no click tracking, no redirect endpoint, no `clicked` webhook
handling. So click-through is structurally 0.0%, which will stay wrong even after (a) and (b).

Two honest options, your call:

- **Track it.** Meta does not report link clicks for template messages; it needs a redirect of our
  own behind the URL button, which is a feature, not a fix.
- **Say it is not measured.** Send `clickThroughRate: null` and the client will show "—" with
  "not measured" rather than a zero. One line each side, and nobody is misled in the meantime.

---

## 4. What the client does in the meantime

Shipped now, so the page stops lying while the above is decided:

- **"—", not "0.0%"**, whenever there are no counted sends to divide by, with a line saying why.
- **A banner** when the counters say nothing was sent *and* the failure log has rows — naming which
  half of the page can be trusted, since they cannot both be right.
- **Empty states** on the trend and funnel instead of a chart of thirty zeroes, which reads as
  "nothing happened" rather than "nothing was counted".
- The page now reads **`GET /reports/overview`** instead of `GET /dashboard`. Same payload, but it
  is gated on `reports.view`, which is the permission the page itself is guarded by — the dashboard
  copy meant reporting data arrived through a permission the page does not require.

None of that produces a number. Only (a) and (b) do.
