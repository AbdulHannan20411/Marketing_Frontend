# Campaign Audience — List the Recipients, Not Just Count Them

Two features shipped today. One needed nothing from you; the other needs one endpoint.

## 1. Group and tag member lists — nothing needed

Groups and Tags now have an eye button on each card that opens the contacts inside. It reads what
already exists:

```
GET /api/v1/contacts?groupId=grp_1&page=1&pageSize=8
GET /api/v1/contacts?tagId=tag_4&page=1&pageSize=8
```

Server-paged, so a group with 40,000 members costs one page. `ContactQuery` already takes both
filters and the `all` sentinel. Nothing to do — noting it so you know the traffic is there.

## 2. The campaign audience — one endpoint, please

The wizard's Audience step shows a recipient count from `POST /campaigns/preview-audience`, and it
is exact: `CountAudienceAsync` deduplicates across groups and excludes non-subscribed contacts.
People want to see *who* those recipients are before they send. That is the whole request.

**The client cannot assemble it.** `GET /contacts` filters by **one** group, so with three groups
selected there is no way to page a deduplicated union — page 2 of a union of three filtered reads
is not a thing the client can compute without holding all three in memory, and the dedup and
consent rules would be reimplemented in the browser where they can drift from yours.

So the dialog currently lists **one group at a time**, with a tab per selected group and a line
saying a contact in two groups appears in both lists. Correct and complete — every recipient is in
one of those lists — but it is not the audience, and the total above it is.

### The ask

```
POST /api/v1/campaigns/preview-audience/contacts?page=1&pageSize=8
{ "groupIds": ["grp_1", "grp_2"], "search": "" }

→ 200 { "data": { "items": [ { "id", "fullName", "initials", "phoneNumber", "status" } ],
                  "totalItems": 1240, "page": 1, "pageSize": 8 } }
```

- **The same predicate as the count**, reusing `CountAudienceAsync`'s query — distinct
  `ContactId`, `!Contact.IsDeleted`, `Status == Subscribed` — then joined to contacts, ordered, and
  paged. If the list and the count are ever built from two predicates they will disagree, and the
  screen will be showing 1,240 recipients above a list that ends at 1,238.
- **A stable order.** `FullName` then `Id`; without the tiebreak, paging can repeat or skip a row.
- **`totalItems` must equal what `preview-audience` returns** for the same `groupIds`. At that
  point the client can drop the separate count call, which is one round trip saved on every group
  toggle.
- **`search` matters more than it looks.** Nobody scrolls 1,240 names; the real question is "is
  Ayesha included?", and that is one filtered read instead of 155 pages. The `WhereMatchesSearch`
  extension already does exactly this matching for the contacts list.
- **Permission and scoping** are the same as `preview-audience` — same tenant resolution, same
  campaign permission. An empty `groupIds` is `totalItems: 0`, not a 400, to match the count.

A slim recipient shape is fine; the dialog shows name, number and consent state. If reusing
`ContactResponse` is less work, that is fine too — the client ignores what it does not render.

### What the client does when it lands

The tabs disappear and it becomes one list with the count already on screen, plus a search box.
Nothing else changes; the dialog is already built.

## 3. Not asking for, but worth knowing

**The recipients actually queued for a campaign that has already run** is a different question
from this one — this is a pre-send estimate against live group membership, and a sent campaign's
recipients are a historical fact in `CampaignMessage`. If `GET /campaigns/{id}/recipients` is cheap
to add, the detail page would use it to answer "did it reach her?" without the failure log. Lower
value than the above, and only for campaigns that have run.
