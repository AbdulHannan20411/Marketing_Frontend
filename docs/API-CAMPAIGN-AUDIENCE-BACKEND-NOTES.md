# Campaign Audience — Listing the Recipients

The endpoint is in, in the shape you asked for. Drop the tabs and the separate count call.

**Restart the API.** No migration — this is a query, not a schema change.

---

## 1. The endpoint

```
POST /api/v1/campaigns/preview-audience/contacts?page=1&pageSize=8
{ "groupIds": ["grp_1", "grp_2"], "search": "" }

→ 200 { "data": { "items": [ { "id", "fullName", "initials", "phoneNumber", "status" } ],
                  "page": 1, "pageSize": 8, "totalItems": 1240, "totalPages": 155 } }
```

The slim shape, as offered — `id`, `fullName`, `initials`, `phoneNumber`, `status`. Not
`ContactResponse`: that would add a tag list and a group list per row, which is two more collection
joins per page for two fields nothing on the screen reads. `status` is always `subscribed`, because
the audience excludes everyone else; it is there so the badge has something to render rather than
because it will ever vary.

`initials` is computed server-side with the same helper the contacts list uses, so the avatars in
this dialog match the ones everywhere else.

`X-Total-Count` is set as well, as on every other paged route.

## 2. The count and the list are the same query

This was the part worth getting right, and I went further than reusing the predicate — I deleted
one of them. There is now a single private `AudienceContactIds(groupIds)`, and:

- `preview-audience` counts it,
- `preview-audience/contacts` uses it as a subquery and joins contacts to it.

`CountAudienceAsync` was rewritten to call it, so the count's behaviour is bit-for-bit what it was
and there is no longer a second definition of "who is in these groups" to drift from. The generated
SQL, pinned by a test:

```sql
SELECT c.id, c.full_name, c.phone_number, c.status
FROM contacts AS c
WHERE ... AND c.id IN (
    SELECT c0.contact_id
    FROM contact_group_members AS c0
    INNER JOIN contacts AS c2 ON c0.contact_id = c2.id
    WHERE ... AND c0.contact_group_id = ANY (@groupIds)
      AND NOT (c2.is_deleted) AND c2.status = 'Subscribed'
) AND (c.full_name ILIKE @term OR c.phone_number ILIKE @term0 OR c.email ILIKE @term1)
ORDER BY c.full_name, c.id
LIMIT @p OFFSET @p
```

So **`totalItems` with a blank `search` equals `recipientCount` for the same `groupIds`** — by
construction, not by agreement. Drop the separate count call and read the total off this response.
A test asserts the two numbers are equal against a fixture with a contact in two groups, an
unsubscribed contact and a deleted one.

With a `search` term, `totalItems` is naturally the count of *matching* recipients. The
"1,240 recipients, 3 matching 'ayesha'" reading is the sensible one, but it is yours to word.

## 3. The rest of your list

**Stable order.** `full_name` then `id`, in the SQL above. Worth spelling out why the tiebreak
matters: two people called Ayesha Khan sort arbitrarily without it, and PostgreSQL is free to break
that tie differently for the page-one query and the page-two query — which shows one of them twice
and loses the other. There is a test that pages through two same-named contacts and asserts the four
ids across both pages are distinct.

**`search` narrows the audience, not the address book.** It is applied after the audience subquery,
through the same `WhereMatchesSearch` the contacts list uses — name, number and email, `ILIKE`, in
the database. One filtered read instead of 155 pages, and the term is a bound parameter (pinned by a
test, since this is user input reaching a `LIKE` pattern).

**Empty `groupIds` is `totalItems: 0`**, not a 400 — matching the count. `null` behaves the same. An
unreadable group id (`tag_4`, `nonsense`) is dropped rather than matched, again exactly as the count
has always done, so a stale client gets one answer from both endpoints.

**Permission and scoping are identical to `preview-audience`**: `campaigns.create`, same
`?adminId=` handling, same tenant resolution. Nothing new to grant.

**`pageSize` is clamped to 100** by the shared `PageRequest`, as everywhere. Asking for 10,000 gets
100 rather than a 400.

## 4. Group and tag member lists

Noted, nothing needed — and you are right that `GET /contacts?groupId=&page=&pageSize=` is server-
paged, so a 40,000-member group costs one page. Both filters go through the same `ContactProjection`
as the main list, so the eye button and the contacts screen cannot disagree about who is in a group.

## 5. Your §3 — recipients of a campaign that has run

Agreed, and agreed that it is a different question: this endpoint is a live estimate against current
group membership, and a sent campaign's recipients are a historical fact in `CampaignMessage`. It is
cheap — `CampaignMessage` already holds the contact and the per-message status, so
`GET /campaigns/{id}/recipients` is a paged read with a status filter and no new tables.

I have **not** built it, because you ranked it lower and it is a new screen's worth of contract
rather than a query (which statuses are worth filtering on? the failure reason inline, or a link to
the failure log?). Say what the detail page needs and it is a short job.

## 6. Tests

11 new in `CampaignAudienceTests`: a contact in two chosen groups counted once; the list total equal
to the count for the same groups; unsubscribed and blocked excluded; a deleted contact excluded; a
contact in an unchosen group excluded; the order stable across a page boundary with duplicate names;
`totalItems` describing the audience rather than the page; no groups as an empty page rather than a
refusal; an unreadable group id dropped; initials and the `cnt_` prefix on every row.

Plus one in `CampaignAudienceSqlTests` that builds the query against the real PostgreSQL provider
and asserts on the generated SQL. That one exists because the substituted repositories above run in
memory, and a captured `IQueryable` inside a `Contains` is exactly the shape that composes in C# and
throws at runtime — this proves the subquery, the `ILIKE`, the `ORDER BY` and the `LIMIT/OFFSET`
translate, without needing a database.

Full unit suite: **717 passing**. API builds clean.

## 7. One line for the client

```
POST /api/v1/campaigns/preview-audience/contacts?page=1&pageSize=8
     { "groupIds": [...], "search": "" }
→ 200 { "data": { items, page, pageSize, totalItems, totalPages } }
```

`totalItems` is the recipient count. Restart the API and it is live.
