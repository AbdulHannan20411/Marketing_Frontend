# Two Small Gaps — Backend Notes

One of them is not the bug you think it is, and the real one is worth more than the caption.

**Restart the API.** No migration.

---

## 1. `tenantId` is not missing. The list has two rows for one workspace.

`tenantId` has never been null on `GET /superadmin/admins`. The query excludes users without a
workspace (`user.TenantId != null`) and the projection sets the id unconditionally — there is no
path through it that produces a row without one. I checked the database too: **zero** admin
accounts with no tenant.

So where did nine-for-ten come from? From your own logs, the repeating burst is:

```
tnt_1, tnt_2, tnt_10, tnt_13, tnt_15, tnt_17, tnt_19, tnt_21, tnt_22
```

and in the database, **`tnt_1` has two admin accounts** — "admin" and "Co Admin". Ten rows, nine
workspaces, no missing id. `GET /superadmin/admins` is a list of *admin accounts*, and a workspace
may have several.

Which means the caption will never appear, and the actual defect is the opposite of the one you
described: **the Security screen shows `tnt_1` twice**, fetches its overview twice, and offers two
rows that open the same workspace.

**Two things done on my side:**

- `AdminAccount.TenantId` is no longer nullable — it was declared `string? = null` and never was
  one. To your question: there is no "admin with no workspace" case to render deliberately. The
  type now says so.
- Its doc comment now says the id is **not unique across the list**, and points at
  `GET /superadmin/tenants` for a screen that wants one row per workspace.

**What I would do on yours.** A screen described as "lists every workspace" should page
`/superadmin/tenants`, not `/superadmin/admins`. That is one row per workspace by construction, it
is server-paged, and it now sorts seven ways from the sorting brief. Deduplicating the admin list
client-side would work too, but it would leave the screen picking arbitrarily between two admins'
rows for the same workspace.

Replace the "No workspace id" caption with nothing; it is a caption on a gap that is not there.

## 2. The `Workspace/current` 404 now says which of the two it is

```
404  You are not currently in a workspace, so there is no 'current' record to read the
     history of. Platform staff select a workspace with ?adminId=.
```

Checked before the record is resolved, so it applies to every `current` lookup, not just
`Workspace` — `AutoReplySettings/current` had the same misleading answer. Still a 404, because
nothing was found; the detail is what changed.

Your client-side fix is right and I would keep it: hiding the button for an unscoped Super Admin is
better than a good error message about a question they should not be asked. The message is for
whoever reads it from an API client, which was your point.

## 3. Your §3

Agreed. Search, sorting and the per-workspace summaries staying client-side is right at this size.

The platform-wide security summary is still the thing that would help, and it is worth noting the
cost is currently visible in the logs: **125 calls to `/superadmin/security/tenants/{id}` in one
day**, including one burst of 33 covering all 22 workspaces. Still not urgent at 22 workspaces;
it will be the first thing to hurt at 200. The endpoint would be one query grouped by tenant rather
than one round trip per row — say when you want it.

## 4. Tests

No new ones. The `tenantId` change is a nullability annotation on a value that was already always
set, and the 404 text is a message rather than behaviour — both are covered by the existing suite,
which stays at **800 passing** with the view-as work. API builds clean.
