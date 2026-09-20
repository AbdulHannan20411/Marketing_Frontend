# Server-Side Paging and Newest-First Threads — Backend Notes

Answer to `API-LIST-PAGINATION-BACKEND.md`. Everything in that brief is built: both ways of reading
a thread from the end, paging on all five lists, and the platform security summary. Nothing in it
was declined.

**Restart the API before testing.** These are code changes, and the running process is an older
build. (That is still true of the performance fixes from the previous round, if it has not been
restarted since then.)

---

## 1. Conversation messages — both `latest` and `before`

```
GET /whatsapp/conversations/{id}/messages?page=1&pageSize=30            → unchanged: oldest first
GET /whatsapp/conversations/{id}/messages?page=1&pageSize=30&latest=true → the newest 30
GET /whatsapp/conversations/{id}/messages?pageSize=30&before=msg_4187    → the 30 before that one
```

Both were implemented, so you can pick either and change your mind later.

- **Always oldest-first inside the page**, in all three modes. Render the array as it arrives.
- `latest=true`, `page=2` is the 30 messages before page 1's, and so on backwards.
- `before=` is exclusive: the cursor message itself is not returned. `pageSize` sets the count
  (there is no separate `limit` parameter — `pageSize` already meant that here).
- **`page` in the response counts from whichever end you asked from.** With `latest` or `before`
  it is "how many pages back from the newest this window is", so the test for older messages is the
  same arithmetic in every mode: `page * pageSize < totalItems` means there are more.
- `totalItems` is always the whole thread.
- An unknown or foreign `before` is a 404 (`Message`), not an empty page — a cursor from another
  conversation is a bug worth seeing.
- Nothing changed for the existing call. `page=1&pageSize=30` with no new parameters is byte for
  byte what it was, including a page past the end being empty rather than the last page.

**Recommendation:** open a thread with `latest=true`, then use `before=<id of the oldest message on
screen>` for "load earlier". That combination never repeats or skips a message when one arrives
mid-read, which page numbers cannot promise — a new message shifts every boundary by one. Your
de-duplication by id can stay, but it stops being load-bearing.

## 2. The five lists

All five keep their current shape and gain paging **opt-in**: send no `page` and no `pageSize` and
you get exactly today's plain array; send either and you get a `PagedResult`. Switch each screen
whenever you like, one at a time.

| Endpoint | Paging | Filters |
| --- | --- | --- |
| `GET /notifications` | `page`, `pageSize` (default 20, max 100) | `unreadOnly=true`, `priority=critical\|warning\|info\|success` |
| `GET /superadmin/admins` | `page`, `pageSize` (default 12, max 100) | `search=`, `status=active\|trialing\|suspended` |
| `GET /employees` | `page`, `pageSize` (default 25, max 100) | `search=` (name, email) |
| `GET /groups` | `page`, `pageSize` (default 25, max 100) | — |
| `GET /tags` | `page`, `pageSize` (default 25, max 100) | — |

Paged answers carry `X-Total-Count` as well, as the already-paged routes do.

**Filters apply in both shapes.** `?unreadOnly=true` with no page parameters returns a filtered
array, not a page — so you can narrow a list without having to page it in the same commit. (A
filtered array is capped at 100 rows; the unfiltered one is still capped at 50, as it always was.)

`search` on `/superadmin/admins` matches the owner's name, their email **and the organisation name**
(you search by customer, not by the person who signed up). It is a case-insensitive `ILIKE`, and the
term is always a bound parameter.

### Notifications: the counts

The paged shape is `PagedResult` plus two fields:

```jsonc
{
  "items": [ /* … */ ],
  "page": 2, "pageSize": 20, "totalItems": 45, "totalPages": 3,
  "unreadCount": 15,      // unread, across everything addressed to this user
  "criticalCount": 2      // unread AND critical
}
```

Both counts **ignore the page and the filters** — they are what the bell means, not what the list
currently shows. `criticalCount` is unread-and-critical, matching what your
`notifications.component.ts` computes today, so the badge logic can move over unchanged.

`totalItems` does follow the filters: `?unreadOnly=true` reports the number of unread, which is what
"Page 1 of N" must be built from.

## 3. `GET /superadmin/security/summary`

```
GET /superadmin/security/summary?page=1&pageSize=10
```

Exactly the shape you specified:

```jsonc
{
  "items": [
    { "tenantId": "tnt_001", "organizationName": "Glow Studio", "people": 6,
      "activeSessions": 4, "highRisk": 1, "mediumRisk": 2, "needsAttention": 3 }
  ],
  "page": 1, "pageSize": 10, "totalItems": 128, "totalPages": 13
}
```

- **Sorted riskiest first across the whole platform**, then by medium risk, then by accounts needing
  attention, then by active sessions, then by name. The ordering is computed over every workspace
  before the page is cut, so page 1 is genuinely the page that matters.
- `people` counts active members; `activeSessions` is sessions alive now across the workspace.
- `needsAttention` is members **over the device limit or displaced from a session in the last 24
  hours** — the two signals that mean a login is being shared, whatever the total score came to. It
  is not `highRisk + mediumRisk` and will sometimes be larger or smaller than either.
- Platform staff never appear in any workspace's numbers.
- `pageSize` defaults to 10 and is capped at 100. This route is always paged; there is no array
  shape, since nothing depended on one.

Risk for the whole page is evaluated in **two queries total**, not two per person — that is what the
old screen was paying, once per customer. `GET /superadmin/security/tenants/{tenantId}` is unchanged
and is still where you go for who, specifically, is the problem.

Go ahead and switch the screen over whenever you want; nothing else is needed from this side.

## 4. Tests

`tests/Marketing.UnitTests/Services/ListPagingTests.cs` and `PlatformSecuritySummaryTests.cs`, 17
tests, all passing (full unit suite: 624 passing).

Covering your list in order: the second page of notifications with a whole-list `totalItems`;
`unreadOnly` narrowing the total as well as the rows; the two counts being identical on page 1,
page 3 and under a `priority` filter; admins paged and filtered with a filtered total; both routes
unpaged returning the full list unchanged; `latest=true` giving the newest page oldest-first inside
itself; and a message arriving between two cursor reads being neither skipped nor repeated.

Plus, on the summary: ordering by risk rather than by name across pages, `needsAttention` without
high risk, platform staff excluded, and the two-query bulk evaluation.

The container-backed integration tests were not run — Docker is not running on this machine. They
are unaffected by these changes.

## 5. One thing to know

`/groups` and `/tags` take paging but no `search`. Their name matching is exact-match `ILIKE` used
for uniqueness checks, and a partial-match fragment is not worth adding until a screen actually
asks. Say the word and it is a few lines.
