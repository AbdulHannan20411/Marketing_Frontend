# Two Small Gaps Found While Fixing the Security Screen

Both are one-liners, both cause a visible hole in the UI, and neither is worth its own document —
so they are here together.

## 1. `tenantId` is missing from some admin accounts

The platform Security screen lists every workspace and opens one with
`/superadmin/tenants/{tenantId}/security`. The id comes from the admin list, and **some rows arrive
without it**, so those workspaces cannot be opened at all. In today's logs nine distinct workspace
ids were fetched for a page of ten rows.

Where a row has no `tenantId` the client now says **"No workspace id"** with a tooltip explaining
that the list did not include one — an empty cell read as a broken button. That is a caption on the
gap, not a fix.

**Ask:** `tenantId` on every `AdminAccount` from `GET /superadmin/admins`. It is already on the
model as optional (`tenantId?: string | null`) and the client treats it as required for this
screen; if there is a case where an admin account genuinely has no workspace — an invitation that
was never completed, say — say so and I will render that case deliberately rather than as an
absence.

## 2. Workspace history 404s for platform staff

`GET /api/v1/audit/Workspace/current` answered **404** at 07:55 today, and
`NotFoundException: Workspace 'current' was not found` is in the log. The caller was a Super Admin
with no admin selected: `current` resolves from `_tenantContext.TenantId`, platform staff have no
tenant of their own, and the client turned the 404 into "history is not available yet" — which
reads as a missing feature rather than "you are not in a workspace".

**Fixed on the client:** the Workspace history button is now hidden for a Super Admin who has not
scoped themselves to an admin through the scope bar. Scoped, the tenant exists and the button works
as it always did for an ordinary admin.

**Worth doing on your side anyway:** the 404's detail could say which of the two it is. "You are not
currently in a workspace" and "that workspace has no history" are different answers, and only one
of them is a reason to go and select an admin. Not urgent — the client no longer asks the question
it cannot answer — but the message is misleading to anyone reading it from an API client.

## 3. Nothing else from the security screen

Search, sorting and the per-workspace summaries are all client-side over data you already send.
The one thing that would genuinely help later is a platform-wide security summary endpoint so the
screen stops fetching one overview per row — noted in the earlier list-pagination brief, still not
urgent at this size.
