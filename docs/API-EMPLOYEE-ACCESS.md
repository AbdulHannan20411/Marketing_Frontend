# Employees, Access Control & Attributed Email — API Notes

> **Superseded as a request.** The backend shipped this, and its own
> *Employees, Access Control & Attributed Email — Frontend Integration Guide* is the authority. The
> front end has been realigned. Kept for the platform-wide conventions this sits inside.
>
> Corrections and differences, all now handled on the client:
>
> | This document said | Reality |
> | --- | --- |
> | Catalogue has **56** permissions | **49** — verified against `permission.model.ts`; backend diffed 49 each side, zero difference |
> | `409 employee_exists`, workspace-scoped | **`409 email_taken`, platform-wide** — the address may belong to another customer |
> | Seat exhaustion as a generic 409 | **`409 seat_limit_reached`** (was a 422 on a field the request lacks) |
> | Escape the subject line too | Subject is **header-sanitised**, not HTML-escaped — otherwise "Smith & Co" arrives as `Smith &amp; Co` |
>
> Also newly enforced server-side and reflected in the UI: `last_admin`, `cannot_target_self`,
> `role_derived_permissions`, `not_invited`, `permission_not_in_plan`, and a 20/hour invite cap.

Base path: `/api/v1/employees`, plus `/api/v1/permission-sets`.

---

## 1. The access model

Three roles, and they are not interchangeable.

| Role | Scope |
| --- | --- |
| `SuperAdmin` | Platform staff. Sees and does everything, in every workspace. Not a tenant member. |
| `Admin` | Owns one workspace. Full access within it, including billing, plan and team. |
| `Employee` | Member of one workspace. Sees **only** what their granted permissions allow. |

**Permissions are per-employee**, drawn from the 49-permission catalogue already in
`core/models/permission.model.ts`. An `Admin` implicitly holds all of them — the UI hides the
permission matrix for admins entirely, because showing a matrix you cannot restrict is a lie.

**Two independent gates**, both of which must pass for a screen to appear:

1. **Permission** — does this user hold it?
2. **Plan module** — does the workspace's plan include the feature at all?

The client enforces both for navigation and route access. **This is a usability measure, not a
security boundary.** Every endpoint must re-check server-side; a hidden button is still a reachable
API call.

### What the client already does

- `permissionGuard` on each route, from `data: { permissions: [...] }`
- Sidebar items filtered by permission **and** plan module
- `*appHasPermission` hides individual affordances
- Denied navigation lands on `/forbidden`

Verified: an employee holding a reduced set sees 6 sidebar items where an admin sees 14, and
navigating directly to `/employees` redirects to `/forbidden`.

---

## 2. Endpoints the UI calls

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/employees` | Everyone in the workspace |
| POST | `/employees/invite` | See §3 — **`permissionSetId` is new** |
| PUT | `/employees/{id}` | `name`, `jobTitle`, `email` |
| PUT | `/employees/{id}/permissions` | **Complete replacement set**, not a delta |
| PUT | `/employees/{id}/role` | `Admin` or `Employee` |
| PUT | `/employees/{id}/status` | `active` \| `suspended` |
| POST | `/employees/{id}/resend-invite` | Re-sends, same token or a fresh one |
| DELETE | `/employees/{id}/invite` | Revokes an unaccepted invitation |
| DELETE | `/employees/{id}` | Removes access; frees a seat |
| GET/POST | `/permission-sets` | Reusable named bundles |
| PUT/DELETE | `/permission-sets/{id}` | |
| POST | `/permission-sets/{id}/apply` | `{ employeeIds }` — overwrites each target |

**Rules the UI relies on:**

- `PUT /permissions` **revokes the employee's sessions**. The UI tells the admin this happens
  ("Their sessions were signed out"), so it must actually happen — a permission you removed that
  survives until their token expires is not removed.
- **No privilege escalation.** An `Admin` may grant only permissions they themselves hold; an
  `Employee` may never change permissions at all. Reject with 403.
- **Seat limits** are enforced on invite, returning 409 with the plan's allowance in `detail`.
- **The last admin cannot be removed or demoted.** Reject with 409 — a workspace with no
  administrator cannot be recovered by its own members.
- Suspending signs the employee out and blocks sign-in; their data stays.

---

## 3. `POST /employees/invite`

```jsonc
{
  "name": "Sara Malik",
  "email": "sara@northwind.io",
  "jobTitle": "Campaign Manager",
  "role": "Employee",
  "permissionSetId": "set_marketing"
}
```

- `role` defaults to `Employee`. `Admin` creates a co-administrator with full access; any
  `permissionSetId` sent alongside it should be ignored.
- **`permissionSetId` is optional and new.** When present, the invitee starts with that set's
  permissions. When absent, they start with **none** — able to sign in, seeing nothing until the
  admin grants access. The UI states this explicitly, so please don't substitute a default bundle.
- `409 employee_exists` if that email is already in the workspace.
- `409` on seat exhaustion, naming the limit.

Returns the created `Employee` with `status: "invited"`.

The invitation link must land on **`/auth/accept-invitation?token=…`** — the page already exists and
`Email:ClientBaseUrl` already points at the app.

---

## 4. Attributed email — the new requirement

Employees are invited by an **Admin**, but the mail leaves the **platform's** SMTP server. The
recipient therefore sees a NextReach address in the `From:` line for a message they expect from a
colleague. Without explicit attribution that reads as spam, and gets ignored or reported.

**Every workspace-originated email must name the human who caused it, in both the subject and the
body.**

### Required shape

```
From:      NextReach <no-reply@nextreach.io>          ← platform's verified sender
Reply-To:  Amara Chen <amara@northwind.io>            ← the admin who invited them
Subject:   Amara Chen invited you to join Northwind Retail on NextReach
```

Body must open by naming the sender and the workspace, for example:

> **Amara Chen** has invited you to work in **Northwind Retail** on NextReach.
> Set your password to get started.
>
> *This invitation was sent by Amara Chen (amara@northwind.io) through NextReach.
> If you weren't expecting it, you can ignore this email.*

The invite dialog shows the admin this exact preview before they send, so the wording should match:
`{senderName} invited you to join {workspaceName} on {appName}`.

### Rules

- **`From:` stays the platform's verified sender.** Do not put the admin's address there — it will
  fail SPF/DKIM for their domain and land in spam. Attribution goes in `Reply-To`, the subject and
  the body.
- **`Reply-To` is the acting admin**, so replies reach a human who knows what the mail is about.
- **Never let a tenant supply the raw subject or body.** Only the name, email and workspace are
  interpolated, and all three must be HTML-escaped — an admin who renames their workspace to
  `<script>` must not be able to inject anything into a mail sent to someone else.
- Apply the same attribution to **every** tenant-triggered mail, not just invitations: re-sent
  invitations, and any future campaign or notification mail an admin causes to be sent.
- **Rate-limit per workspace.** A tenant with an invite endpoint and a shared sending reputation is
  a spam vector; if one workspace gets the platform's domain blacklisted, every other tenant stops
  receiving mail.

If you later want mail to come genuinely *from* the admin's own domain, that needs per-tenant
verified sending domains (SPF/DKIM records they add). That is a much larger piece of work — say so
and I will design the UI for it, but it is not what this document asks for.

---

## 5. Super Admin override

A Super Admin must be able to do everything an Admin can, inside any workspace, through the same
endpoints.

- They pass `?adminId=adm_2` and the API resolves that workspace's tenant.
- **Required on writes** — a Super Admin has no tenant of their own, and without it the call fails
  `403 tenant_not_resolved`. The scope interceptor already attaches it to `/employees` and
  `/permission-sets`.
- Seat limits and plan-module gates **do not apply** to a Super Admin acting in a workspace. They
  are platform staff; a plan ceiling is a billing construct, not a security one.
- Every such action must be **audited with the acting Super Admin's identity**, not the workspace's.
  "Someone in Northwind Retail removed an employee" is wrong and unfalsifiable if it was actually
  platform staff.

Verified working today: a Super Admin selecting an admin sees that workspace's 7 employees with the
full toolset, including Invite.

---

## 6. Front-end status

| Piece | File |
| --- | --- |
| Team list, lifecycle actions, seat gauge | `features/employees/employees.component.*` |
| Invite dialog with the email preview | `features/employees/employee-invite.component.*` |
| Permission matrix and permission sets | same component, `matrix` / `sets` tabs |
| 49-permission catalogue, categories, module mapping | `core/models/permission.model.ts` |
| Route enforcement | `core/guards/permission.guard.ts` |
| Affordance hiding | `shared/directives/has-permission.directive.ts` |
| Sidebar gating | `core/config/navigation.config.ts` + `core/services/layout.service.ts` |

Everything in §2 is wired. What is **not** built, because no endpoint exists:

- **No audit view of who changed whose permissions.** `/admin/audit` exists; if permission changes
  land there with a usable shape, I will add the screen.
- **No bulk invite.** One at a time.
- **No per-tenant sending domains** — see §4.

To exercise the whole flow without a backend, set `useMockApi: true` in
`web/src/environments/environment.ts` and sign in as `admin@nextreach.io` / `Password1!`.
