# Server-Side Paging for the Remaining Lists, and Newest-First Threads — Backend Requirements

From a pass over every page for render speed and paging. **The frontend is done**: each list below
now renders one page at a time, and the inbox shows the newest messages. Two things still need the
API, one of them a correctness problem.

---

## 1. Conversation messages come back oldest first (worth fixing)

`InboxService.ListMessagesAsync` orders by `OccurredAt` **ascending**, so `page=1` is the *start* of
the history. A conversation with 200 messages therefore returned messages from weeks ago, and the
inbox had no way to reach today's.

**What the frontend does now:** it asks for page 1, reads `totalItems`, works out the last page and
fetches that — **two requests** to open any thread longer than 30 messages. "Load earlier messages"
then walks backwards.

**What would be better**, either is fine:

**(a) A `latest` flag**

```
GET /whatsapp/conversations/{id}/messages?page=1&pageSize=30&latest=true
```

Returns the newest `pageSize` messages, still ordered oldest-first *within the page* so the client
can render them as they are. `page=2` with `latest=true` is the 30 before those. This removes the
extra request.

**(b) A cursor**

```
GET /whatsapp/conversations/{id}/messages?before={messageId}&limit=30
```

Returns the 30 messages immediately before that one, oldest-first, plus `hasMore`. This also
survives new messages arriving while someone reads, which page numbers don't: a message sent during
reading shifts every page boundary by one, so "load earlier" can repeat or skip a message. The
client de-duplicates by id today, so the effect is invisible, but a cursor removes the cause.

Keep the current behaviour working either way — the client handles both.

---

## 2. Lists that return every row

These endpoints return the whole collection. The frontend now pages them **in the browser**, which
fixes the rendering cost but not the transfer. Two of them grow without bound:

| Endpoint | Grows with | Priority |
| --- | --- | --- |
| `GET /notifications` | Every notification ever sent to the user | **High** |
| `GET /superadmin/admins` | Every customer on the platform | **High** |
| `GET /employees` | The team; capped by the plan | Low |
| `GET /groups` | Audiences | Low |
| `GET /tags` | Tags | Low |

**What to add**, matching the pattern `/contacts`, `/campaigns` and `/admin/audit` already use:

```
GET /notifications?page=1&pageSize=20&unreadOnly=false&priority=critical
GET /superadmin/admins?page=1&pageSize=12&search=glow&status=active
```

Both return the standard `PagedResult<T>`: `items`, `page`, `pageSize`, `totalItems`, `totalPages`.

- **Accept the filters the screens use**, so paging and filtering agree: notifications filter by
  read state and priority; admins by search text (name, organisation, email) and status.
- **Keep the unfiltered shape working.** The client sends no page parameters today. As
  `CampaignsService` already does, returning `PagedResult` when asked and a plain array otherwise
  lets both live side by side, and I'll switch each screen over as its endpoint lands.
- **Notifications also needs its counts** — unread and critical — regardless of the page, either as
  extra fields on the response or from the existing badge endpoint. The bell count must not become
  "unread on this page".

---

## 3. A platform security summary (removes N requests)

`/superadmin/security` has no summary endpoint, so the page builds one: it lists the admins, then
calls `GET /superadmin/security/tenants/{tenantId}` **once per workspace**. That was one request per
customer to draw one screen. The frontend now fetches only the ten workspaces on the visible page,
four at a time, which makes it usable — but the right fix is one endpoint:

```
GET /superadmin/security/summary?page=1&pageSize=10
```

```jsonc
{
  "items": [
    {
      "tenantId": "tnt_001",
      "organizationName": "Glow Studio",
      "people": 6,
      "activeSessions": 4,
      "highRisk": 1,
      "mediumRisk": 2,
      "needsAttention": 3     // over the device or displacement threshold
    }
  ],
  "page": 1, "pageSize": 10, "totalItems": 128, "totalPages": 13
}
```

Sorted riskiest first, so page 1 is the page that matters. With this, the screen becomes a single
request per page, its totals can cover the whole platform rather than the page, and sorting by risk
works across pages. **Ask me and I'll switch the page over — it's a small change on my side.**

---

## 4. Nothing needed for these

Already server-paged and left alone: contacts, campaigns, campaign runs, templates, tenants, audit
logs, payments, import batches and rows, and the inbox conversation list.

---

## 5. Tests

1. `GET /notifications?page=2&pageSize=20` → the second 20, with `totalItems` for the whole list.
2. `GET /notifications?unreadOnly=true&page=1` → unread only, and `totalItems` counts unread only.
3. The unread and critical counts are the same whichever page is requested.
4. `GET /superadmin/admins?search=glow&page=1&pageSize=5` → matches only, paged.
5. Both endpoints without page parameters → today's full array, unchanged.
6. `…/messages?latest=true` (or `before=`) → the newest page, oldest-first inside the page.
7. A message arriving between two "load earlier" requests → no message is skipped or repeated.
