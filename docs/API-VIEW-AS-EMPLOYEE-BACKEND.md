> **Resolved.** `?viewAsEmployeeId=` is live as middleware on every tenant-scoped GET, with
> `capabilities.viewAsEmployee` on `/auth/me`. The client sends it on reads only, never on writes,
> never on `/superadmin`, `/admin`, `/plans` or `/auth`, and only when the capability is true — so
> an API without it still gets today's menu-only preview. The banner now distinguishes the two.
> Kept for the record; the record of the preview lives on the workspace activity feed, which was
> the backend's call and the right one.

# View as Employee — What the Client Can and Cannot Do Alone

An admin wants what Super Admins have with `?adminId=`: pick one of their team and see the product
the way that person sees it. Half of it is shipped and needs nothing from you. The other half is
yours, because it is an authorisation boundary and the client cannot be the one enforcing it.

## 1. Shipped: the permission preview

"View as" on each teammate in Employees drives the **real** navigation and the **real** permission
gates from that employee's permissions. The sidebar, the buttons, the route guards — all of it
narrows to what they would get. A banner says who is being previewed and offers the way back
(always, since the teammate may not be able to open Employees).

The one property that matters:

```ts
hasPermission(permission) {
  const granted = this.currentUser()?.permissions.includes(permission) ?? false;
  const previewed = this.preview();
  return granted && (previewed === null || previewed.permissions.includes(permission));
}
```

**It intersects — it never widens.** A tampered preview can only hide things, never unlock them,
and the API authorises the token regardless. It lives in memory, so it cannot survive a reload or
leak into another session. Four tests pin exactly that.

The banner is equally blunt about the limit, because this is the honest half:

> Their menu and permissions. The records are still yours — anything you do here is recorded as you.

## 2. Not shipped, because it cannot be: the data

The question people actually ask is "why can't Ayesha see that conversation?", and that is a
question about **rows**, not menus. The client cannot answer it: the API scopes every read to the
token, and a client that filtered an admin's own data to look like an employee's would be inventing
a permission boundary in the browser. It would be wrong about the interesting cases — the ones
where nobody is sure what the employee can see, which is why they opened it.

So this asks for the same shape you already built for platform staff.

### The ask

```
GET /api/v1/inbox/conversations?viewAsEmployeeId=emp_42
```

A query parameter, mirroring `?adminId=`, honoured on tenant-scoped reads:

- **Authorised server-side.** The caller must be an `Admin` or co-admin **in the same tenant** as
  the employee. Anyone else is a 403; an employee id from another tenant is a 404, not a 403, for
  the same reason the audit endpoint answers that way.
- **Applies the employee's effective permissions to the request**, exactly as if they had made it —
  their WhatsApp numbers, their assigned conversations, their contact scope. If the employee could
  not have read it, neither can the preview.
- **Reads only.** A write carrying `viewAsEmployeeId` is a 400. An admin who wants to act acts as
  themselves; a mode where writes silently land under someone else's name is a different feature
  with different consequences, and not one I would ask for casually.
- **Audited once per entry**, not per request: "Honey viewed the app as Ayesha Khan". The audit
  trail is what makes this acceptable to the person being viewed.

### The capability flag

The client will not offer data-level preview until the API says it exists — a flag on
`GET /auth/me` is enough:

```jsonc
{ "capabilities": { "viewAsEmployee": true } }
```

Without it the client keeps today's behaviour: the menu narrows, the data does not, and the banner
says so. With it, the banner changes to "Viewing Ayesha's data, read-only" and the interceptor
starts attaching the parameter. One flag, no version negotiation.

### Why a flag rather than just trying

If the API ignored an unknown parameter, the client would show a banner claiming to be viewing
somebody else's data while showing the admin's own. That is worse than not having the feature: it
is a confident wrong answer to a question about access.

## 3. Scope of "tenant-scoped reads"

The same exclusion list `scopeInterceptor` already uses: nothing under `/superadmin`, `/admin/`,
`/plans` or `/auth/`. Those are platform-level or identity routes where narrowing to an employee
is meaningless.

## 4. What I need from you, in one line

`?viewAsEmployeeId=` honoured on tenant-scoped GETs with the employee's own effective permissions,
refused on writes, plus `capabilities.viewAsEmployee` on `/auth/me`. Tell me it is live and the
client switches over in one commit — the picker, the banner and the exit are already built.
