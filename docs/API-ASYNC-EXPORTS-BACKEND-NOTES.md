# Asynchronous List-View Exports — Implementation Report

Built end to end, both repos. **Restart the API** — one migration (`AddExportJobs`), already
applied to the dev database.

---

## 1. Architecture

```
Angular list view
   │  POST /api/v1/exports   { dataset, format, search, filters, sort, columns }
   ▼
.NET API — validate, insert, publish, return          ← no data read here
   │  202 { jobId, status: "queued", reused }
   ▼
export_jobs row  (Queued)          ← the durable record
   │
   ▼
RabbitMQ / MassTransit  ExportJobQueued { exportJobId, tenantId }   ← 2 numbers
   │
   ▼
ExportJobConsumer → ExportRunner
   │  claim (Queued → Processing, optimistic)
   │  count, then stream rows in one ordered cursor
   │  write through to a temp file  (CSV or XLSX)
   │  progress → job row + Redis + SignalR, per 1,000 rows
   │  IFileStorage.SaveAsync → opaque key
   ▼
export_jobs row  (Completed, file key, size, expiresAt)
   │
   ▼
SignalR  exportProgress → the requesting user's group only
   │
   ▼
Angular toast → Export centre → GET /exports/{id}/download  (re-authorised)
```

Two sweeps behind it, on the existing Quartz scheduler: expired files deleted, and exports that
were never picked up published again.

## 2. Backend changes

**New**

| File | What |
| --- | --- |
| `DataAccess/Entities/ExportJob.cs` | The durable record |
| `DataAccess/Migrations/…_AddExportJobs.cs` | Table + 4 indexes |
| `Application/Services/Exports/ExportContracts.cs` | `IExportDataset`, `ExportQuery`, `ExportColumn`, registry |
| `Application/Services/Exports/ExportJobStates.cs` | The state machine |
| `Application/Services/Exports/ExportJobService.cs` | Create, list, download, retry, cancel |
| `Application/Services/Exports/ExportRunner.cs` | The worker core |
| `Application/Services/Exports/ExportMaintenanceService.cs` | Expiry + stall recovery |
| `Application/Services/Exports/IExportFileWriter.cs` | Format seam |
| `Application/Services/Exports/Datasets/ContactExportDataset.cs` | Contacts |
| `Application/Services/Exports/Datasets/DeliveryFailureExportDataset.cs` | Delivery failures |
| `Application/Contracts/ExportMessages.cs` | `ExportJobQueued` |
| `Application/DTOs/Exports/ExportDtos.cs` | Wire types |
| `Infrastructure/Exports/ExportFileWriters.cs` | CSV + XLSX writers |
| `Infrastructure/Messaging/Consumers/ExportJobConsumer.cs` | The first consumer on the bus |
| `API/Controllers/ExportsController.cs` | 7 routes |
| `Scheduler/Jobs/Maintenance/ExportMaintenanceJob.cs` | Every 10 minutes |

**Changed** — `ContractEnums` (two enums), `PublicId` (`exj_`), `AppConstants` (cache key),
`IRealtimeNotifier` + `SignalRRealtimeNotifier` (`PublishExportProgressAsync`, `exportProgress`),
`ApplicationDbContext`, `DomainConfigurations`, the three DI extensions, and
`ContactProjection` — its sort allow-list moved up from `ContactService` so the list and the
export cannot diverge.

## 3. Frontend changes

`core/models/export.model.ts`, `core/services/exports.service.ts`,
`core/services/export-notification.service.ts`, `features/exports/exports.component.{ts,html}`
(the export centre), plus edits to `realtime.service.ts`, `shell.component.ts`,
`navigation.config.ts`, `app.routes.ts` and `contacts.component.ts`.

## 4. RabbitMQ

The bus already existed and had **no consumers** — its own comment called `configureBus` "the seam
that will carry them". `ExportJobConsumer` is the first. Queue name is `export-job-queued` by the
kebab-case formatter; the receive endpoint's existing policy gives 3 retries at 5s and then
`export-job-queued_error`.

The message is two longs. Everything else is on the row, so the message cannot disagree with the
database. The `tenantId` is **checked against the row, not trusted** — a mismatch is refused and
logged at Error.

Idempotency is the row's status, not a dedupe table: a redelivery of a completed export finds
`Completed`, does nothing and acknowledges. A `BusinessRuleException` from the state machine is
caught and acknowledged rather than retried — the third attempt would find the same state as the
first.

**The import outbox is untouched.** It solves a different problem (work that must commit in the
same transaction as the row causing it) and rewriting it onto the broker was not asked for.

## 5. Redis / Memurai

One use: the latest progress reading, at `marketing:t:{tenant}:export:{job}:progress`, 10-minute
TTL. It is a convenience so a reconnecting client can be told where an export is without a
database read.

It is **never** the source of truth — the job row is — and it is allowed to be unavailable, which
it currently is on this machine. Everything was built and tested with Redis down.

No files in Redis. No job state in Redis.

## 6. SignalR

One event, `exportProgress`, carrying the whole lifecycle with a `status` field — queued,
processing, completed, failed. Four events would be four client handlers that have to agree about
one row.

Sent to `RealtimeHub.UserGroup(requestedByUserId)` and nowhere else. Not the tenant group: an
export names a file and a row count for data one person chose to extract.

The payload carries no storage key and no URL. Downloading goes back through the API.

## 7. File storage

Existing `IFileStorage` → `LocalFileStorage`, container `exports` (separate from `contact-imports`,
so a retention rule can treat extracted data differently from uploads). The job row holds the
opaque key; the client only ever holds the job id.

Written through a **temp file on disk**, not a buffer — a million-row CSV is a few hundred MB, and
holding it to write it and again to upload it is how a worker gets killed on the one export that
mattered.

## 8. Security

- **Dataset permission** — each dataset declares the permission its own list requires
  (`contacts.view`, `reports.export`). Checked on create; `/exports/datasets` only lists what the
  caller holds, so the dialog never offers a 403.
- **Column allow-list** — a client names columns by catalogue key. There is no request that can
  reach a property path, a navigation or an expression. An unknown key is a 422, not a silent drop.
- **Filter allow-list** — each dataset reads the handful of filter names it understands through
  the list view's own query object, so an unknown name narrows nothing rather than reaching SQL.
- **Tenancy** — the worker enters `ITenantContext.BeginScope(tenantId)` before reading anything,
  so the ordinary global filters apply exactly as they would to a request. The message's tenant is
  verified against the row first.
- **Ownership** — every read, download, retry and cancel is `RequestedByUserId == caller`. A
  colleague's id is a **404**, never a 403.
- **Download** — re-checks signed in, ownership, tenant, status, file present and not expired.
  Expiry is checked on read as well as by the sweep, so a file that expires between sweeps is
  still refused.
- **File names** — built from the dataset's display name and a date, then sanitised. Nothing the
  client sent reaches the name or the path.
- **Writes gated** — `POST /exports` is a write, so the subscription gate applies: a workspace
  with no plan cannot queue exports.

## 9. Large datasets — measured, not asserted

Streamed through `IQueryExecutor.StreamAsync` (the abstraction already documented for exports):
one ordered cursor, rows consumed and dropped as they arrive. **Not** offset paging, which
re-scans the index from the top for every batch and makes a large export quadratic.

Measured against the real database, 50,000 contacts, filtered and sorted:

```
count      = 50,000 in 712 ms
wrote      = 50,000 rows, 5.6 MB, in 1,476 ms
progress callbacks: 50   (one per 1,000 rows — not 50,000)
managed heap peak during write: 15.1 MB
```

15 MB for a 5.6 MB file is the property that matters: memory is one batch, not one export. The
seeded rows were removed afterwards.

**XLSX is capped at 200,000 rows** and says so, because ClosedXML builds the workbook in memory.
Larger exports should use CSV, which streams. Truncating silently, or letting the allocator kill
the worker, were the two worse options.

Progress writes use short-lived DI scopes, because the streamed read holds its connection for the
duration and Npgsql will not multiplex.

## 10. List views supported

| Dataset key | List | Permission |
| --- | --- | --- |
| `contacts` | Contacts | `contacts.view` |
| `failures` | Delivery failures | `reports.export` |

Adding a third is one class and one `AddScoped`. Everything else — job, queue, writers, storage,
notification, expiry, download authorisation — is shared.

**The contacts screen now takes two paths**, and the dividing line is "can this time out", not
"is this large today":

- **a ticked selection** streams straight back as it always did — waiting 200 ms beats a toast
  and a trip to the export centre;
- **a filtered export** is unbounded, so it goes through the pipeline.

The existing synchronous routes (`GET /contacts/export`, `GET /reports/failures/export`) are
unchanged and still work.

## 11. Testing

| | |
| --- | --- |
| Backend build | clean, no new warnings |
| Backend unit tests | **882 passing** (830 before, 52 new) |
| Angular build | clean |
| Angular tests | **365 passing** (355 before, 10 new) |
| Data path | 50,000 rows against the real database, above |
| Storage | save → open → delete round trip, real `LocalFileStorage` |

New tests cover: the job created and queued; **no data read on the request path**; the message
carrying only an identifier; the commit ordered before the publish; the list-view state captured
verbatim; default and ordered columns; a column outside the allow-list refused; an unknown
dataset; a caller without the list's permission; five clicks producing one export; a different
filter being a different export; a colleague's export invisible and undownloadable; history
scoped to the caller; unfinished, expired and vanished files each refused correctly; retry and
its restrictions; cancel; every state transition and every one that must not be allowed; a
redelivery unable to restart a finished export; CSV BOM and quoting; progress batched per 1,000
and not per row; XLSX typed cells; and, on the client, the request shape, the download path, the
toasts for ready and failed, silence during progress, and "started" versus "already running".

## 12. Remaining limitations — genuine ones only

1. **I could not run the full HTTP → broker → worker → SignalR chain.** Signing in needs
   credentials I will not fabricate, and you stopped the API when I tried to start it. Every
   layer is verified — the data path against 50k real rows, the rest by unit test — but the
   assembled flow has not been watched once. **Please run it**: open Contacts, clear the
   selection, click Export, and watch for the toast. If anything is wrong it will be in the
   wiring, and the log lines are EventIds 4200–4242.
2. **Redis is still down on this machine**, so the progress cache path ran only in its
   degraded form. It is designed to be optional and the job row carries the real count.
3. **XLSX over 200,000 rows is refused**, not streamed. Fixing it properly means a SAX writer
   (`OpenXmlWriter`) rather than ClosedXML — worth doing if anyone asks for a 500k-row workbook.
4. **Cancellation is cooperative at batch boundaries**, so a cancel during a long single query
   takes effect when that query returns.
5. **The export centre is not paged.** It shows the most recent 20; `?page=` works on the API.
6. **Two datasets only.** Campaigns, templates, employees and the audit log are each one class —
   and the audit log is the one your newest brief asks for, so I would add it with that work.
