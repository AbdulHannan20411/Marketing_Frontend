> **Status: implemented.** The filters described below are now in the API — `AuditLogQuery`,
> applied in `PlatformService.GetAuditLogAsync` before the sort and before the count. Seven tests in
> `PlatformAuditFilterTests` cover them. What remains open is §3 (the actor directory), §4
> (a server-side export) and the Critical decision in §6.

# Audit Log — Filters, and an Export That Exists

`GET /admin/audit` takes a bare `PageRequest` and applies paging and sorting. That is all a
reviewer gets: newest first, twenty-five at a time, across every workspace on the platform. Finding
what one person did last Tuesday means paging.

The client now sends four more parameters and offers the controls for them. **None of them do
anything yet** — this asks for the four, plus the export route.

---

## 1. What the client sends today

```
GET /admin/audit?page=1&pageSize=25&sortBy=occurredAt&sortDirection=descending
                &search=deleted&actor=Ayesha%20Khan&from=2026-08-28T00:00:00.000Z
```

| Parameter | Meaning | Absent means |
| --- | --- | --- |
| `search` | free text over the actor, the action and the record | no text filter |
| `actor` | exact actor name, as the entries report it | everyone |
| `from` | inclusive ISO instant | no lower bound |
| `to` | inclusive ISO instant | no upper bound |

Each is omitted entirely when unset — never sent empty — so binding them as nullable is enough and
there is no sentinel to handle.

## 2. What is needed

Add them to a query type of its own — `PageRequest` is shared and does not want an `Actor`:

```csharp
public sealed class AuditLogQuery : PageRequest
{
    public string? Actor { get; init; }
    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }
    // Search is already on PageRequest.
}
```

Applied to `joined` in `GetAuditLogAsync`, **before** `ApplySort` and before the count:

- `From` / `To` on `entry.OccurredOn`. The cheapest and most valuable of the four: it is the one
  filter with an index behind it, and it is what makes the other three affordable.
- `Actor` as an equality match on the joined `actor.DisplayName`. The client has no user id to send
  — `AuditLogEntryResponse` carries `Actor` as a name and nothing else. **If you would rather filter
  by id, add `UserId` to the response** and I will send that instead; it is the better key, since
  two people can share a display name.
- `Search` as a case-insensitive contains over `actor.DisplayName`, `entry.Action` and
  `entry.EntityName` — the three columns the row shows.

Note the left joins: an entry written by the system identity has no actor row and a platform-level
entry has no workspace. A filter that does not account for the null will silently drop exactly the
entries a reviewer opens this screen to find.

## 3. The actor picker

The "filter by person" dropdown is currently built from the actors visible on the page, because
there is no endpoint for the platform's distinct actors. That makes it a shortcut over what is on
screen rather than a directory — fine, and obvious to the person using it, but not what it should
be.

If it is cheap:

```
GET /admin/audit/actors?from=&to=
→ 200 { "data": [ { "userId": "usr_12", "name": "Ayesha Khan", "workspace": "Glow Studio" } ] }
```

Distinct actors appearing in the log, respecting the date range so the list shrinks with it. I will
switch the dropdown to it and send `userId` instead of `actor`. Not urgent; the shortcut works.

## 4. Export

**`GET /admin/audit/export`**, taking the same `AuditLogQuery`, returning `text/csv` through the
same `ApiControllerBase` export helper the other exports use. Columns as the screen shows them:
When, Who, Action, Record, Workspace, Severity, IP address.

Until it exists the client builds the file itself, by paging at `pageSize=100` and stopping at
**5,000 rows**, then warns that the export was truncated. That works, and it is the wrong shape:
fifty requests to produce one file, and a cap that a real audit export should not have. The button
was previously wired to nothing at all, which is what was reported.

One request worth making explicit: the export must apply the same filters and the same sort as the
screen. An export that silently returns everything, or returns it in a different order, is not the
thing the person was looking at.

## 5. Why this matters more here than on other lists

An audit log is the one list read when something has gone wrong, and the reader already knows
roughly who and roughly when. Without a date range that knowledge is worth nothing and the screen is
a scroll. It is also the list that grows fastest and is never deleted — the only one here where the
absence of filtering gets strictly worse every day it is left.

---

## 6. Severity — a fifth parameter, and a tab that cannot match

`severity` now goes to the API too:

```
GET /admin/audit?page=1&pageSize=25&severity=warning
```

`critical` | `warning` | `info`, omitted for every severity.

It was being applied in the browser, to the twenty-five rows already on screen, while the pager went
on reporting the full count. So "Warning" showed however many of *that page* were warnings, page two
showed a different number, and the total underneath described neither. A filter that narrows one
page of a paged list is not a filter — it is a worse lie than no filter, because it looks like one.
That is fixed on the client by sending it; it needs applying on yours.

### It maps to `Action`, not to a column

Severity is derived rather than stored:

```csharp
row.Action == AppConstants.AuditAction.Deleted ? AuditSeverity.Warning : AuditSeverity.Info
```

So the filter is a predicate over `Action`, matching the derivation exactly — and the derivation
should be the single source for both, not written out twice:

- `warning` → `Action == Deleted`
- `info` → `Action != Deleted`
- `critical` → **nothing**

### The Critical tab

There is no action that derives to `Critical`, so the tab is empty by construction and always has
been. Two ways to settle it, and it is your call which:

1. **Define it.** A deletion is not the most serious thing in this log — permission grants, role
   changes, employee suspensions and plan changes are the entries somebody comes here after an
   incident to find. Promote those to `critical` and demote `Deleted` to `warning`, which is what
   the words already imply.
2. **Drop it**, and the client drops the tab with it.

I have kept the tab rather than removing it, because which actions count as critical is a decision
about the product and not one to make from the client. Until it is settled, selecting Critical
returns an empty page — correctly now, rather than by filtering a page that never had any.

---

## 7. Export — implemented, and why the client version had to go

`GET /admin/audit/export` now exists, taking the same `AuditLogQuery` and streaming CSV through the
shared `StreamCsvAsync` helper. Columns: When, Who, Action, Record, Workspace, Severity, IP address.

The filtered, joined, sorted query is now named once — `AuditQuery(request)` — and both readers use
it: `GetAuditLogAsync` pages it, `StreamAuditLogAsync` streams it. Two copies would have drifted,
and the failure would have been silent: a file that does not match the list it was exported from,
which nobody checks until it matters.

**What it replaces.** The client was building the file itself, reading the list endpoint at a
hundred rows a time. A sixty-eight page log meant sixty-eight requests, and it gave up at five
thousand rows — so a large export was both expensive and quietly incomplete. That code is deleted,
along with the CSV writer it needed.

Rows stream to the response as they are read, so neither the server nor the browser holds the file,
and there is no row cap.

### Not the async export pipeline, and why

The obvious alternative was a third `IExportDataset` beside `contacts` and `failures`. I did not,
because the export runner is tenant-scoped by construction — `ExportRunner` does
`ITenantContext.BeginScope(job.TenantId)` and refuses a job whose tenant does not match the message.
The audit log is platform-wide and its reader is a Super Admin with no tenant of their own, so an
audit dataset would need the runner to support an unscoped job. That is a change to the one piece of
code where a mistake crosses tenants, it is yours, and it is not worth making for this.

If audit exports later grow past what a request should carry, that is the change to make — and it
should be made deliberately, with the platform-scoped job as its own reviewed concept rather than a
nullable tenant id.
