# Contact Import — API Notes

> **Superseded as a request.** The backend shipped this module, and its own
> *Contact Import API — Frontend Integration Guide* is the authority on the contract. The front end
> has been realigned to it. What follows is kept for the parts the guide does not cover — the
> platform-wide conventions this module sits inside, and the four issues that still affect it.
>
> Where this document and the backend's guide disagree, the guide wins. The known differences from
> the original request, all now implemented on the client:
>
> | Originally requested | As delivered |
> | --- | --- |
> | `duplicateStrategy` in the commit body | Multipart field on **upload**; fixed for the batch |
> | `skip` / `update` / `create` | `Skip` / `Update` only, PascalCase |
> | Commit body with default status, tags, groups | **Commit takes no body** — status/tags/groups come from mapped columns |
> | `fullName` and `phoneNumber` both required | **`phoneNumber` only** |
> | Cancel allowed while committing | **409** once committing starts |
> | XLSX template | **CSV** template, `contact-import-template.csv` |
> | Rows filter accepts any casing | Must be PascalCase; an unknown value matches **nothing** |

---

## 1. Route prefix

The brief says `/api/contact-imports`. **Use `/api/v1/contact-imports`** — every other endpoint in
this platform is versioned and the SPA's `apiBaseUrl` already ends in `/api/v1`.

All responses use the standard envelope:

```json
{ "data": { }, "message": "string | null", "traceId": "guid" }
```

Failures are RFC 7807 problem documents, **not** enveloped, and carry a stable `errorCode`. Business
rules return **409**, matching the rest of the API.

---

## 2. Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/contact-imports/template` | Blank XLSX with the expected headers. Raw file, no envelope. |
| POST | `/contact-imports` | Multipart `file`. Stores, queues, returns immediately. |
| GET | `/contact-imports?page&pageSize` | Paged history, newest first. |
| GET | `/contact-imports/{batchId}` | Full detail. |
| GET | `/contact-imports/{batchId}/rows?page&pageSize&status` | Paged rows. `status` is `all` or a row status. |
| PUT | `/contact-imports/{batchId}/mapping` | Save the column mapping. Returns the updated detail. |
| POST | `/contact-imports/{batchId}/commit` | Queues the import. Returns immediately. |
| POST | `/contact-imports/{batchId}/cancel` | Returns the updated detail. |
| POST | `/contact-imports/{batchId}/failed-records/export` | Queues workbook generation. |
| GET | `/contact-imports/exports/{exportId}` | Export job status. |
| GET | `/contact-imports/exports/{exportId}/download` | The workbook. Raw file, no envelope. |

**Upload and commit must return in well under a second.** The UI shows "your file is being processed
in the background" and navigates away; it never waits for a result. If either call does the work
inline, the whole design breaks.

Paged responses use the existing shape:

```json
{ "items": [], "page": 1, "pageSize": 10, "totalItems": 0, "totalPages": 1 }
```

---

## 3. Enums

Wire values are **PascalCase**. The client maps them to its own casing; do not send anything else.

```
BatchStatus : Pending | Processing | AwaitingMapping | Committing
              Completed | CompletedWithErrors | Failed | Cancelled

RowStatus   : Pending | Valid | Imported | Updated | Duplicate | Skipped | Failed

ExportStatus: Pending | Processing | Completed | Failed
```

`AwaitingMapping` is the pause where the user confirms the mapping. The UI stops polling there and
resumes after it acts, so **the worker must actually stop and wait** — do not auto-commit.

Terminal states are `Completed`, `CompletedWithErrors`, `Failed`, `Cancelled`. The UI stops watching
on all four.

### Error codes (row level)

```
InvalidPhoneNumber   MissingRequiredField   InvalidEmail
DuplicateContact     DuplicateInFile        UnsupportedColumn
InvalidCountry       DatabaseError          PlanLimitExceeded
```

Send the code; the front end owns the wording. Send `message` too as a fallback for codes added
later — an unrecognised code renders `message` rather than breaking.

---

## 4. DTOs

### Upload response — `POST /contact-imports`

```json
{
  "batchId": "imp_9f3c",
  "fileName": "contacts.xlsx",
  "fileSizeBytes": 412000,
  "status": "Pending",
  "uploadedAt": "2026-08-13T09:14:00Z"
}
```

### List item — `GET /contact-imports`

```json
{
  "batchId": "imp_9f3c",
  "fileName": "contacts.xlsx",
  "fileSizeBytes": 412000,
  "status": "CompletedWithErrors",
  "statistics": {
    "totalRows": 1000, "successful": 750, "updated": 100,
    "duplicates": 120, "failed": 15, "skipped": 15
  },
  "uploadedAt": "2026-08-13T09:14:00Z",
  "completedAt": "2026-08-13T09:19:00Z",
  "uploadedBy": "Ayesha Khan",
  "hasFailedRecords": true
}
```

`hasFailedRecords` drives the "Failed rows" action. Return `false` when there is nothing to export,
even if `failed > 0` — for example once the generated file has expired.

### Details — `GET /contact-imports/{batchId}`

List item, plus:

```json
{
  "progressPercent": 62,
  "detectedColumns": ["Name", "Mobile", "Email Address", "Country", "Segment"],
  "suggestedMapping": { "fullName": "Name", "phoneNumber": "Mobile", "email": "Email Address",
                        "country": "Country", "status": null, "tags": "Segment", "groups": null },
  "mapping": null,
  "errorGroups": [ { "code": "InvalidPhoneNumber", "count": 9 } ],
  "failureReason": null,
  "planLimit": { "contactLimit": 1000, "currentContacts": 950, "skippedForLimit": 50 }
}
```

- `detectedColumns` may be empty while `Pending`/`Processing`; the UI hides the mapping until it fills.
- `mapping` is `null` until saved — the client falls back to `suggestedMapping`.
- `progressPercent` is **reported, not inferred**. Send real progress; the UI draws it directly.
- `failureReason` is for batch-level failure (unreadable file, worker gave up), not row errors.
- `planLimit` is `null` until a ceiling is actually relevant. When `skippedForLimit > 0` the UI shows
  an upgrade prompt naming the numbers.

### Row — `GET /contact-imports/{batchId}/rows`

```json
{
  "rowNumber": 42,
  "status": "Failed",
  "values": { "Name": "Amara Okafor", "Mobile": "07xx", "Country": "Narnia" },
  "errors": [ { "code": "InvalidPhoneNumber", "field": "Mobile", "message": "Not dialable." } ]
}
```

`values` is keyed by **source column header**, matching `detectedColumns` — the UI renders one table
column per detected column. `rowNumber` is the spreadsheet row (header is 1).

### Mapping request — `PUT .../mapping`

```json
{ "mapping": { "fullName": "Name", "phoneNumber": "Mobile", "email": null,
               "country": null, "status": null, "tags": null, "groups": null } }
```

All seven keys are always sent; `null` means unmapped. `fullName` and `phoneNumber` are required —
reject with 409 `mapping_incomplete` if either is null.

### Commit request — `POST .../commit`

```json
{
  "duplicateStrategy": "skip",
  "defaultStatus": "subscribed",
  "assignTagIds": ["tag_1"],
  "assignGroupIds": [],
  "skipInvalidRows": true
}
```

`duplicateStrategy` is `skip` | `update` | `create` (lowercase — it matches the existing contact
API). `defaultStatus` is `subscribed` | `unsubscribed` | `blocked`. `skipInvalidRows: false` means
refuse the whole batch if any row is invalid.

### Commit response

```json
{ "batchId": "imp_9f3c", "status": "Committing", "queuedAt": "2026-08-13T09:15:00Z" }
```

### Export job — `POST .../failed-records/export`, `GET /exports/{exportId}`

```json
{
  "exportId": "exp_1a2b",
  "batchId": "imp_9f3c",
  "status": "Completed",
  "fileName": "failed-records-imp_9f3c.xlsx",
  "rowCount": 15,
  "requestedAt": "2026-08-13T09:20:00Z",
  "completedAt": "2026-08-13T09:20:04Z",
  "failureReason": null
}
```

The client polls this at 2s → 3s → 5s → 10s, stops on `Completed`/`Failed`, then downloads using
`fileName`. Give up after ~40 polls, so mark a stuck job `Failed` rather than leaving it `Processing`
forever.

---

## 5. Realtime — preferred over polling

Push on the **existing** `/hubs/realtime` hub, method name `importProgress`:

```json
{
  "batchId": "imp_9f3c",
  "status": "Committing",
  "progressPercent": 62,
  "statistics": { "totalRows": 1000, "successful": 620, "updated": 0,
                  "duplicates": 0, "failed": 4, "skipped": 0 },
  "occurredAt": "2026-08-13T09:17:00Z"
}
```

Group membership is resolved server-side from the token's claims, exactly as `campaignProgress`
already does. There is no join method and a client must not be able to subscribe to another tenant's
stream.

Emit on every meaningful transition and periodically during long commits (every few seconds is
plenty). The client treats an event as a *trigger to refetch*, not as the source of truth, so a
dropped event costs one delayed refresh and nothing more.

**Without the hub the UI still works** — it falls back to polling at 5s, 5s, 10s, 10s, then 15s, and
stops entirely once the batch settles. With the hub connected it only keeps a 30s safety-net timer.

> Note: SignalR is currently unreliable in dev. The client has to use
> `skipNegotiation: true` + WebSockets because the CORS policy rejects the `X-Requested-With` header
> the negotiate request sends. Adding that header to the allowed list would restore negotiation and
> the long-polling fallback.

---

## 6. Backend-only acceptance conditions

These are not visible to the client but the feature is not done without them.

**Tenancy.** Resolve the tenant from the authenticated context only — the client never sends a
`TenantId` and must never be able to. Every read and write is scoped: batch, rows, generated
workbook, and the contacts written. A user from tenant A must get 404 (not 403) for tenant B's
`batchId`, so ids are not enumerable.

*One sanctioned exception:* a SuperAdmin acting inside an admin's workspace sends `?adminId=`, which
this platform already supports on other modules. Honour it on **all** contact-import routes,
including POST/PUT — the current API accepts it on GET and rejects writes with
`403 tenant_not_resolved`, which would make the import screens read-only for platform staff.

**Idempotency.** RabbitMQ redelivers. A second `process` message for a parsed batch, or a second
`commit` for one already `Completed`, must be a no-op returning the existing state — not a second
import. Use status checks inside the transaction plus unique constraints as the backstop; do not
rely on the check alone.

**Constraints.** Tenant-aware uniqueness on live rows: `(TenantId, NormalizedPhoneNumber)` for
contacts, `(TenantId, Name)` for groups and tags, `(TenantId, ContactId, ContactGroupId)` and
`(TenantId, ContactId, ContactTagId)` for membership. Respect the existing soft-delete architecture —
uniqueness applies to live rows only.

**Large files.** Stream the parse, batch the writes and the duplicate lookups, size the batches by
config. Row-at-a-time `SaveChangesAsync` is not acceptable at 100k rows.

**Plan limit.** Enforce in the commit worker, never in the client. With 950 of 1000 used and 100 new
rows: import 50, skip 50, and report it through `planLimit.skippedForLimit` so the UI can say so and
offer an upgrade.

**Recovery.** A batch stuck in `Processing` or `Committing` past a threshold must be detectable and
recoverable by the scheduler. Never mark a batch complete before the database state is committed.

**Observability.** Structured logs carrying `BatchId`, `TenantId`, `UserId`, `CorrelationId` for
uploaded / queued / processing started / processing completed / commit started / commit completed /
failed / export started / export completed. Do not log contact PII.

---

## 7. Front-end status

Built and working against the mock:

| Piece | File |
| --- | --- |
| Domain models, error wording, upload limits | `core/models/contact-import.model.ts` |
| Wire DTOs + mappers (the only place the wire shape is known) | `core/dto/contact-import.dto.ts` |
| HTTP client | `core/services/contact-import.service.ts` |
| Push + backoff polling | `core/services/import-notification.service.ts` |
| Failed-record export flow | `core/services/import-export.service.ts` |
| Upload, history, detail | `features/contacts/import/` |
| Hub subscription | `core/services/realtime.service.ts` |

Routes: `/contacts/import` and `/contacts/import/:batchId`, guarded by the `contacts.import`
permission and the `crm` module; mirrored under `/superadmin/...` behind the scope guard.

To demo the whole flow without a backend, set `useMockApi: true` in
`web/src/environments/environment.ts`.
