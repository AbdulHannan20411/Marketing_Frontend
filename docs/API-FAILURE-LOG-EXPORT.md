# Reports — Failure Log Export

Raised because the **Export** button on the failure log did nothing. The cause was ours: the handler
was a stub that showed *"Export queued — a CSV download link will be emailed when it is ready."*
Nothing was queued and no email was ever sent.

That is fixed on the client, and it works today without any backend change. One endpoint would make
it correct at scale.

---

## 1. What the client does now

`GET /reports/failures/export` → CSV blob → saved as `delivery-failures.csv`.

**On `404` — and only 404 — it falls back** to walking `GET /reports/failures` page by page and
rendering the CSV in the browser. So the button works before you build anything.

Falling back on *any* error would be worse than failing outright: a `500` or an expired session
would quietly produce a file assembled from whatever the client could still read, and a partial
failure log that looks complete is a worse artefact than no file at all. So the fallback is scoped
to the one status that means "not implemented".

---

## 2. `GET /api/v1/reports/failures/export`

Requires `reports.export` (or `reports.download.csv` — say which you prefer and I will match it).

Streams `text/csv`, one row per undelivered message, across **the whole result set** — not a page.

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="delivery-failures.csv"
```

Columns, in this order:

| Column | Source |
| --- | --- |
| `Recipient` | `phoneNumber` |
| `Contact` | `contactName` |
| `Campaign` | `campaignName` |
| `Reason` | `reason` |
| `Error code` | `errorCode` |
| `Occurred at` | `occurredAt`, ISO 8601 |

**`Error code` is its own column deliberately.** The reason text already contains it — *"Graph API
returned 401. Code 190"* — but buried in prose it cannot be sorted or filtered, and grouping by code
is the first thing anyone does with a failure log.

Two formatting details the client-side fallback already applies, worth matching so the two paths
produce identical files:

- **RFC 4180 quoting** — every cell quoted, embedded quotes doubled. Reason strings contain commas
  routinely and occasionally newlines.
- **A UTF-8 BOM.** Without it Excel renders accented names mangled, and this data is full of them.

### Why the endpoint is still worth building

The fallback issues one request per 200 rows. For a workspace with a bad campaign behind it that is
a lot of round trips to produce one file, and the client holds every row in memory to do it. A
streamed server response has neither problem.

### Filters

The failure log is unfiltered today, so the export is too. If you add filters to
`GET /reports/failures` later, the export must take the same parameters — an export that silently
ignores the filters on screen is a bug report waiting to happen.

---

## 3. Not asked for, but worth deciding

The old stub promised an **emailed link**, which suggests someone once intended an async export.
For a failure log a direct download is right — it is small and wanted immediately. If you would
rather queue large exports and email them, tell me and I will build the job-status UI instead; what
must not happen is the message promising one thing while the code does another.
