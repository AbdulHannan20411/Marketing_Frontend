# A Contact's History Is Empty After Editing It

Reported as "when I am updating the contacts no history audit is coming". It is not the client and
it is not the audit trail failing — both are working exactly as built. The evidence is in your own
logs, and the cause is a gap in what a contact's history covers.

## 1. What actually happened

From `logs/marketing-20260926.json`, five contact updates this morning:

| Request | Statements in the save |
| --- | --- |
| `PUT /contacts/cnt_26` | 3 audit rows · `UPDATE contact_group_members` · `INSERT contact_group_members` · `INSERT contact_tag_assignments` |
| `PUT /contacts/cnt_27` | 3 audit rows · same three membership statements |
| `PUT /contacts/cnt_26` | 5 audit rows · 2 tag inserts, 1 tag update, 1 group update, 1 group insert |
| `PUT /contacts/cnt_26` | 7 audit rows · 3 tag inserts, 2 tag updates, 1 group update, 1 group insert |
| `PUT /contacts/cnt_20` | 4 audit rows · 2 group inserts, 1 group update, 1 tag insert |

**Not one of them contains an `UPDATE contacts`.** Every edit changed the contact's groups and tags
and nothing on the contact row itself. The interceptor did its job — it wrote between three and
seven audit rows each time — but those rows are `ContactGroupMember` and `ContactTagAssignment`,
not `Contact`.

`GET /audit/Contact/cnt_27` then answered `200` with an empty page, three times in a row at
07:14:42, :43 and :44 — somebody reopening the panel and finding nothing. Correctly, by its own
rules: there is no `Contact` history, because the `contacts` row never changed.

## 2. Why that reads as a bug

To the person using it, a contact's groups and tags **are** part of the contact — they are edited in
the contact's own dialog, under the contact's own name. Putting them in a different record's history
means the one question the panel exists to answer — "who changed this contact, and what did they
change?" — comes back blank for the most common edit anyone makes.

Worse, those entries are in the history of `ContactGroupMember`, which is not a registered record
type and has no screen. They are written, stored forever, and unreadable by anyone.

## 3. The ask

**Include a contact's membership rows in its history.** `ContactGroupMember` and
`ContactTagAssignment` both carry `ContactId`, so the read is a second predicate on the same audit
table:

```csharp
// In RecordHistoryService, for the Contact registry entry only:
//   entity_name = 'Contact'              AND entity_id = <id>
//   OR entity_name IN ('ContactGroupMember','ContactTagAssignment')
//      AND entity_id IN (SELECT id FROM ... WHERE contact_id = <id>)
```

The join-row ids are not the contact's id, so the second arm needs the lookup — or, more cheaply, a
`RelatedEntityId` column written by the interceptor when an entity implements something like
`IBelongsTo<Contact>`. Your call; the second is the tidier one if other join tables will follow.

**What the client renders.** It groups a change set into "N fields changed" and lists the fields, so
the natural shape is an entry per membership change with a readable field:

```jsonc
{ "action": "created", "entityName": "ContactGroupMember",
  "changes": { "Group": { "old": null, "new": "Winter leads" } } }

{ "action": "deleted", "entityName": "ContactTagAssignment",
  "changes": { "Tag": { "old": "VIP", "new": null } } }
```

Group and tag **names** rather than ids, if that is reachable without a join per row — otherwise
ids, and I will live with it. The panel already renders whatever the change set contains; nothing
on the client has to know these are join rows.

## 4. The other half: stop rewriting memberships that did not change

Look at the third and fourth rows of the table above — seven audit rows for one save. The update
path replaces a collection whenever the request supplies it:

```csharp
if (request.TagIds is not null) { await ReplaceTagsAsync(...); }
```

and `ReplaceTagsAsync` soft-deletes every existing row and inserts them again, **even when the set
is identical**. That is one `UPDATE` and one `INSERT` per membership per save, plus an audit row
each, for a change nobody made.

**Fixed on the client today:** the contact editor now omits `tagIds` and `groupIds` when they match
what the contact was loaded with, so an ordinary name edit no longer touches the join tables at all.

**Worth fixing on your side too**, because the client is not the only caller and a diff is cheap:
compare the requested set against the stored one, remove what left, insert what arrived, leave the
rest alone. Then §3's entries describe real changes instead of a rewrite.

## 5. What is already correct

Nothing else needs touching, and it is worth saying so explicitly:

- The interceptor fires on every contact save and writes the rows.
- `GET /audit/Contact/{id}` resolves `cnt_27` and answers 200 — the id, the prefix, the permission
  and the tenant scoping are all right.
- The empty-update rule (`changes.Count == 0 && Updated` → no row) is right, and is why a save that
  moved nothing on the contact leaves no "somebody pressed Save" entry.

Only §3 and §4.
