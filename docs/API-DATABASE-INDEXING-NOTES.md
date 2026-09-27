# Database Indexing — What Is Actually Filtered, and What Now Has An Index

Thirteen indexes added, four superseded ones dropped, one PostgreSQL extension installed.
**Restart the API** — one migration (`AddSearchAndHotPathIndexes`), already applied to the dev
database. No API contract changed; nothing on the client needs touching.

---

## 1. How the filters were chosen

Two sources, and only one of them is trustworthy.

**`pg_stat_user_tables` / `pg_stat_user_indexes` on the dev database** — read first, and largely
discarded. It reports 600 sequential scans of `contacts` and zero uses of most contact indexes,
but the table holds eighteen rows: below roughly a hundred rows PostgreSQL correctly prefers a
sequential scan to any index, so "this index is unused" on dev means nothing about production.
It was useful for exactly one thing: showing which queries run *often*, regardless of cost.

**Reading every filter, sort and background poll in the codebase** — which is what the decisions
below actually rest on. Counting the polls is the part that changes the ranking: a screen a human
opens twice a day matters far less than a query a scheduler runs every ten seconds forever.

The observed call frequency on dev, over a few hours:

| Table | Sequential scans | Driven by |
| --- | --- | --- |
| `whatsapp_connections` | 1,919 | `WhatsAppOnboardingJob`, every 5s |
| `campaigns` | 1,911 | `CampaignDispatchJob`, every 60s |
| `conversation_messages` | 931 | `AutoReplyDispatchJob`, every 10s |
| `contacts` | 600 | the contacts list and search |
| `user_sessions` | 149 | the security screen |

## 2. The finding that dominated everything else

**Every search box in this product is `ILIKE '%term%'`, and a leading wildcard cannot use a B-tree
index. Not slowly — not at all.**

`ContactQueryExtensions`, `SearchQueryExtensions` and `CatalogQueryExtensions` all build
`$"%{search.Trim()}%"`. A B-tree is ordered by prefix, so a pattern that does not start with a
literal has no range to descend into; PostgreSQL scans the table and runs the pattern against
every row. No amount of composite B-tree indexing changes that by one millisecond.

The only index shape PostgreSQL offers that answers an infix match is a **trigram GIN index**
(`pg_trgm`), which indexes every three-character substring.

### Measured, on 200,000 rows shaped like real contacts

A scratch table, seeded, indexed, `EXPLAIN ANALYZE`d, dropped. Not the real `contacts` table —
the last time I seeded that for a measurement I left rows behind.

| | search count | search page |
| --- | --- | --- |
| **Today** (no trigram) | 53.9 ms — *parallel* seq scan | 55.3 ms — *parallel* seq scan |
| One multicolumn GIN | 29.9 ms | 49.0 ms |
| **Three single-column GINs** | **15.6 ms** | **14.8 ms** |

I expected one multicolumn index to win on size and maintenance and was wrong on both counts.
The search is an `OR` across three columns, which the planner answers with a `BitmapOr` of three
index scans; separate indexes let it scan only the columns it needs, and a multicolumn GIN stores
the column number beside every trigram, making it *larger* (19 MB against 17.2 MB). Three
separate indexes it is.

Note the word *parallel* in the "today" row: each search currently burns two cores.

## 3. The indexes added

### Contacts — the busiest list in the product

| Index | Why |
| --- | --- |
| `(tenant_id, created_on DESC) WHERE is_deleted = false` | **The list as it opens.** There was no index for this at all. |
| `(tenant_id, status, created_on DESC) WHERE is_deleted = false` | replaces the ascending, unfiltered version |
| `gin (full_name gin_trgm_ops)` | search |
| `gin (phone_number gin_trgm_ops)` | search |
| `gin (email gin_trgm_ops)` | search |

The first one is the gap worth explaining. `(tenant_id, status, created_on)` already existed and
looks like it covers the list — but `status` sits *between* the tenant and the sort key, so when
no status is chosen (which is how the screen opens) the index yields rows in no useful order and
the whole tenant has to be read and sorted.

**Measured: 56.3 ms of parallel sequential scan becomes 0.142 ms.** Roughly 400×, on the first
query every user runs after signing in.

### Campaign messages — one row per recipient per firing, the largest table at scale

| Index | Why |
| --- | --- |
| `(campaign_id, status, id) WHERE is_deleted = false` | replaces `(campaign_id, status)` |
| `(tenant_id, sent_on DESC) WHERE sent_on IS NOT NULL AND is_deleted = false` | **new** |
| `(meta_message_id) WHERE meta_message_id IS NOT NULL` | now partial |

`ClaimPendingAsync` reads `where campaign_id = … and status = 'Pending' order by id limit n`. With
two columns the database finds *every* pending row — early in a large campaign, the entire
audience — and sorts it to return fifty. Carrying the key as the third column means the rows are
already in order: read fifty entries, stop.

`GetSendTimesSinceAsync` is the per-tenant send-rate check, and it runs **before every batch the
dispatcher sends**. Nothing covered it, so a workspace's entire send history was scanned once a
minute per running campaign. This is the worst of the gaps found.

### Conversation messages — the highest-frequency query in the system

`(direction, occurred_at DESC) WHERE is_deleted = false`

The auto-reply poll asks, every ten seconds across every tenant, for "inbound messages from the
last twenty-four hours, newest first". Nothing covered it, so each run sequentially scanned every
message ever exchanged on the platform — a table that only ever grows, read six times a minute,
forever. This is the 931 scans in the table above, on a dev database with no messages in it.

### Conversations — inbox search

`gin (contact_name gin_trgm_ops)`, `gin (wa_id gin_trgm_ops)` — same reasoning as contact search.
The inbox is searched constantly, because it is how an agent finds the thread they were just in.

### Audit logs — the screen that just grew filters

| Index | Why |
| --- | --- |
| `(occurred_on DESC)` | **new** |
| `(user_id, occurred_on DESC)` | replaces the bare `(user_id)` |

`AuditLog` is not a `BaseEntity`, so it carries no tenant query filter, and the platform audit
screen reads across every workspace. The existing `(tenant_id, occurred_on DESC)` therefore
answers nothing there — a tenant-leading index is no use when no tenant is named. The new
date-range filters and the newest-first default both need a plain descending time index.

The bare `user_id` index could find one person's entries but left the ordering to a sort over
everything they had ever done; carrying the time settles it.

`(entity_name, entity_id, occurred_on DESC)` already existed and already serves the record-history
panel exactly. Untouched.

## 4. What this costs

Indexes are not free, and the trigram ones are the least free of the set.

**Measured: 50,000 contact inserts take 272 ms with no trigram indexes and 2,693 ms with all
three — ten times slower, +2.4 seconds.**

That is the honest headline, and here is the honest framing: 2.4 seconds is on a bulk
`INSERT … SELECT`, where index maintenance is nearly all of the work. The real CSV import runs
batched through EF Core in a background job, where per-row overhead dominates and the proportion
is much smaller — and it is a background job, so 2.4 seconds is not in anyone's way. Traded
against a search that stops burning two cores per keystroke, it is worth paying.

Disk: about 17 MB of trigram index per 200,000 contacts.

## 5. Deploying this to production safely

**The migration creates indexes without `CONCURRENTLY`, which takes an `ACCESS EXCLUSIVE` lock and
blocks all writes to the table while the index builds.** On the dev database, with empty tables,
this was instant. On a production `contacts` or `campaign_messages` table with millions of rows a
GIN build can take minutes, and for those minutes nothing can write to the table.

EF Core migrations cannot issue `CREATE INDEX CONCURRENTLY`, because it may not run inside a
transaction and every migration is wrapped in one.

If these tables are already large in production, the safe path is to create the indexes by hand
first and then mark the migration as applied:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY ix_contacts_full_name ON contacts USING gin (full_name gin_trgm_ops);
-- … the remaining twelve, each CONCURRENTLY …
INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260927172417_AddSearchAndHotPathIndexes', '10.0.0');
```

Ask me for the full script if you want it. If production is still small, just run the migration.

`pg_trgm` is a *trusted* extension from PostgreSQL 13 onward, so the database owner can install it
without superuser. This database is 18.1.

## 6. What I deliberately did not index, and why

- **`users`, `tenants`, `contact_groups`, `contact_tags`, `subscription_plans`** — all searched
  with `ILIKE` too, but all small. A few thousand rows is a sub-millisecond sequential scan, and a
  trigram index there would cost write time to save nothing measurable. Worth revisiting for
  `users` if the platform passes roughly 50,000 accounts.
- **`delivery_failures` search** — the predicate exists (`WhereFailureMatches`) but the paged
  endpoint does not expose search yet; the code comment says as much. When that screen grows a
  search box, it wants the same trigram treatment.
- **`audit_logs` search** — it `ILIKE`s across `entity_name`, `entity_id` and the *joined* actor
  name. A trigram index cannot help the joined column, and the planner will not combine one well
  across a join, so this needs the date range to do the narrowing. Which is why §3 prioritised the
  time index.

## 7. One thing worth deciding, which I did not do unasked

**There are 50 indexes of the form `(is_deleted) WHERE is_deleted = false`** — one per table,
generated by `BaseEntityConfiguration`.

A partial index whose only key column is pinned to a constant by its own filter has no
selectivity: every entry holds the same value. It cannot narrow anything, and the planner will not
choose it while any better index exists — on the dev database, every one of them shows
`idx_scan = 0`. Meanwhile all 50 are maintained on every insert, update and delete across the
whole schema.

They are small today (1 MB total) because the tables are small; the cost is write amplification,
not disk. Removing them is a one-line change to `BaseEntityConfiguration` and one more migration.

**I did not do it** — you asked me to add indexes, and dropping 50 of them across every table in
the schema is a different and larger change than that. Say the word and it is quick.

## 8. Verification

| | |
| --- | --- |
| Backend build | clean, no new warnings |
| Unit tests | **889 passing**, 0 failing |
| Migration | applied to dev; `has-pending-model-changes` reports none, so the snapshot matches |
| Indexes | all 13 read back from `pg_indexes` with the intended columns, `DESC` and filters |
| Superseded indexes | confirmed dropped |
| `pg_trgm` | installed, version 1.6 |
| Scratch tables | dropped; `select count(*) from pg_tables where tablename like 'zz_%'` returns 0 |

**One repair outside the task.** `tests/Marketing.IntegrationTests/Routing/RealtimePushBudgetTests.cs`
did not compile — `AppNotification` had gained a `Category` parameter and the test's call was never
updated, so the whole integration project failed to build. It is unrelated to this work and
predates it (committed in `db5235b`), but it meant no integration test could run at all. One line;
those two tests now pass.

The other 17 integration tests fail on `Failed to connect to Docker endpoint` — Testcontainers,
and Docker is not running on this machine. Unchanged by this work.
