# Workspace Module — API Specification

Complete backend contract for the **Employees**, **Subscription** and **Billing** screens, plus the
customer-facing **Pricing** page they link to.

Companion to [`API-REQUIREMENTS.md`](./API-REQUIREMENTS.md) (envelope, errors, auth, tenancy) and
[`API-AUDIENCE-MODULE.md`](./API-AUDIENCE-MODULE.md). Read §1–§5 of the main document first; this one
does not repeat those rules.

Front-end sources: `features/employees/`, `features/subscription/`, `features/billing/`,
`features/pricing/`, `core/services/employees.service.ts`, `core/services/subscription.service.ts`,
`core/services/entitlement.service.ts`.

---

## 1. What the screens do

### Employees (`/employees`)

Three tabs over one dataset.

- **Team** — every member with avatar, name, role badge, status badge, job title, email, *permission
  count*, and relative last-active time. A per-row "Permissions" button jumps to the matrix.
- **Permission matrix** — an employee picker, then all 8 permission categories with every permission as
  a row. Each row has a toggle; each category header has a "grant all" toggle and an `n / m` counter.
  Edits are held **as a local draft** — a "Save" button commits, "Discard" reverts, and an "unsaved
  changes" marker appears meanwhile. A category whose module is not in the plan is **rendered but
  disabled**, labelled "Not in plan".
- **Permission sets** — reusable named grants, with an "Apply to selected" action that loads the set
  into the current employee's draft.

Above the tabs sits a **seat usage bar** driven by the subscription's `employees` usage metric. When
seats are exhausted the "Invite employee" button is disabled and an upgrade prompt appears.

### Subscription (`/subscription`)

Read-only overview: plan name, status badge, price, billing cycle with period dates, next renewal date,
expiry date, days remaining, auto-renew state, and a **billing-cycle progress bar**. Then four circular
usage rings (contacts, campaigns, employee seats, storage), linear bars for platform usage (API
requests, messages today, messages this month) and connected channels (WhatsApp, email, social
accounts), and a grid of included vs locked modules.

### Pricing (`/pricing`)

Plan cards built entirely from the API, with a monthly/yearly toggle, "Most popular" / "Recommended" /
"Limited offer" ribbons, per-plan limits table, and a "Choose plan" button.

### Billing (`/billing`)

Summary tiles (outstanding, paid to date, next charge) and three tabs: **Invoices**, **Payments**,
**Renewals**. Invoices have a PDF download; failed payments have a Retry action. A banner appears when
any payment has failed.

---

## 2. Scoping note — important

Every endpoint in this document is **scopable**: the client's scope interceptor attaches `?adminId=` to
*all* API calls when a Super Admin has selected an Admin. So `/subscription`, `/billing/history` and
`/employees` will each receive it.

When `adminId` is present and the caller is a `SuperAdmin`, return **that Admin's real subscription,
billing history and employees** — not the Super Admin's own, and not synthetic unlimited values.

> **Known client-side quirk, flagged for your awareness:** the front end currently treats a Super Admin
> as unrestricted *regardless of scope*, so while impersonating an Admin the usage gauges render ∞
> rather than that Admin's real limits. The API should still return the true figures; we may change the
> client to show real limits while scoped. Returning honest data now means no API change when we do.
> See §11 question 1.

---

## 3. Employees

### 3.1 List employees

```
GET /api/v1/employees
```

Returns `Employee[]` — unpaged; the UI renders a list and a picker from the same call. If a tenant could
exceed ~200 employees, tell us and we will move to `PagedResult`.

```ts
type EmployeeStatus = 'active' | 'invited' | 'suspended';

interface Employee {
  id: string;                  // "emp_001"
  name: string;
  initials: string;            // server-computed from name
  email: string;
  jobTitle: string;
  role: 'SuperAdmin' | 'Admin' | 'Employee';
  status: EmployeeStatus;
  permissions: string[];       // effective grant — see below
  lastActiveAt: string | null; // null for an invitee who has never signed in
  invitedAt: string;
}
```

`permissions` must be the **effective** set — exactly what that person's access token would carry. The
matrix renders directly from it, and the Team tab shows `permissions.length`. A role-derived list that
ignores per-user overrides will make the matrix show the wrong state.

Permission: `settings.employees`.

### 3.2 Invite employee

```
POST /api/v1/employees/invite
```

```ts
interface InviteEmployeeRequest {
  email: string;
  name: string;
  jobTitle?: string;
  role?: 'Admin' | 'Employee';   // default "Employee"; see the guard below
  permissions?: string[];        // defaults to the Employee starter grant
  permissionSetId?: string;      // alternative to an explicit list
}
```

Creates the employee with `status: "invited"`, `lastActiveAt: null`, and dispatches an invitation email
carrying a single-use, time-limited token. Returns the created `Employee` with `201`.

Rules:

| Condition | Status | Notes |
| --- | --- | --- |
| Seat limit reached | `422` | See §7. This is the common case — the UI disables the button but the API is the real gate. |
| Email already a member | `409` | Include the existing member's name in `detail`. |
| Email already invited | `409` | Offer resend rather than duplicating. |
| Caller tries to grant `role: "Admin"` without being one | `403` | |
| Caller tries to grant `SuperAdmin` | `403` | Never assignable through this endpoint. |
| Permission not held by the caller | `422` | An Admin must not be able to grant a permission they lack — this is a privilege-escalation guard, and it matters. |

Supporting endpoints:

```
POST   /api/v1/employees/{id}/resend-invite      -> null
DELETE /api/v1/employees/{id}/invite             -> null      // revoke a pending invitation
POST   /api/v1/employees/accept-invite           -> AuthTokens // anonymous; body { token, password }
```

Permission: `settings.employees`.

### 3.3 Update permissions

```
PUT /api/v1/employees/{id}/permissions
```

```jsonc
{ "permissions": ["dashboard.view", "contacts.view", "contacts.create"] }
```

This is the matrix's Save. The array is the **complete replacement** set, not a delta — the client sends
everything currently ticked. Returns the updated `Employee`.

Requirements:

1. **Validate every string** against the permission catalogue; `422` listing unknown values.
2. **Reject permissions the caller does not hold** — `403`. Without this an Admin can escalate a
   subordinate beyond themselves.
3. **Reject permissions whose module is not in the plan.** The matrix disables those categories, but
   enforce it: a tenant without the `social` module cannot grant `social.posts.publish`.
4. **Propagate promptly.** The target's existing access token still carries the old claims. Either keep
   token lifetimes short (≤ 15 min) and accept the lag, or maintain a token-version claim you bump on
   permission change so stale tokens are refused. **Say which you implement** — it determines whether we
   need to surface "changes apply within N minutes" in the UI.
5. **Audit** every change: actor, target, permissions added and removed.

An `Admin`'s or `SuperAdmin`'s permissions are role-derived. The UI shows a notice that role grants take
precedence; the API should return `409` if asked to edit them, rather than silently accepting.

Permission: `settings.employees`.

### 3.4 Update status and role

```
PUT /api/v1/employees/{id}/status     { "status": "suspended" }
PUT /api/v1/employees/{id}/role       { "role": "Admin" }
PUT /api/v1/employees/{id}            { "name"?, "jobTitle"?, "email"? }
```

- Suspending must **revoke active sessions immediately** — a suspended employee should not keep working
  until their token expires.
- A suspended employee still occupies a seat unless you decide otherwise. **State your choice**; it
  changes the seat-usage figure in §5.
- Never allow a caller to suspend or demote themselves — `422` with a clear message. Locking the last
  Admin out of a workspace is worse than the inconvenience of refusing.

Permission: `settings.employees`.

### 3.5 Remove employee

```
DELETE /api/v1/employees/{id}
```

Frees a seat. Refuse removal of the last remaining `Admin` with `409`. Records they authored
(campaigns, contacts) must survive — reassign ownership or keep a display name snapshot, since
`Campaign.createdBy` is a plain string the UI renders.

Permission: `settings.employees`.

---

## 4. Permission sets

```
GET    /api/v1/permission-sets            -> PermissionSet[]
POST   /api/v1/permission-sets            -> PermissionSet
PUT    /api/v1/permission-sets/{id}       -> PermissionSet
DELETE /api/v1/permission-sets/{id}       -> null
POST   /api/v1/permission-sets/{id}/apply -> Employee[]   // body { employeeIds: string[] }
```

```ts
interface PermissionSet {
  id: string;
  name: string;
  description: string;         // never null
  isSystem: boolean;           // system sets cannot be edited or deleted
  permissions: string[];
  assignedCount: number;       // employees currently holding exactly this set
}
```

- Ship at least two system sets (`isSystem: true`): a workspace-admin set and the employee default. The
  UI badges them "System" and must not offer destructive actions — return `403` if asked.
- `name` unique per tenant, `409` on collision.
- `assignedCount` is server-computed. Define it as "employees whose effective permissions exactly match
  this set" and be consistent — the UI displays it beside the permission count.
- `apply` is a bulk assignment; it overwrites each target's permissions and is subject to every rule in
  §3.3.

Permission: `settings.employees`.

---

## 5. Subscription

### 5.1 Read the current subscription

```
GET /api/v1/subscription
```

Returns `SubscriptionSnapshot` — the single most important response in this module. It drives the
Subscription page, the dashboard's executive widgets, every usage gauge, the sidebar's module gating and
all upgrade prompts.

```ts
interface SubscriptionSnapshot {
  subscription: Subscription;
  plan: SubscriptionPlan;      // the full plan, embedded — do not send only an id
  usage: UsageMetric[];
}
```

```ts
type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'suspended' | 'cancelled';
type BillingCycle       = 'monthly' | 'yearly';

interface Subscription {
  planId: string; planName: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currentPeriodStart: string;  // drives the cycle progress bar
  currentPeriodEnd: string;
  nextRenewalAt: string | null;// null when auto-renew is off or the plan is cancelled
  expiresAt: string;           // drives "days remaining" and the renewal warning
  autoRenew: boolean;
  trialEndsAt: string | null;  // non-null only when status is "trial"
  seatsPurchased: number;
  amount: number;              // charge for one period, in major units
  currency: string;            // ISO 4217
}
```

Behaviour the client depends on:

- `expiresAt` drives **days remaining**, the amber "renews in N days" chip in the topbar (≤ 14 days) and
  the dashboard progress ring. It must be a real future timestamp, not a nullable placeholder.
- `currentPeriodStart` / `currentPeriodEnd` drive the cycle progress bar. `End` must be after `Start`.
- A tenant with **no subscription** should return `404`; the client renders a "choose a plan" state.
  Do not return an empty object.
- `plan` is embedded in full because the page lists included and locked modules from `plan.modules`.

Permission: `settings.subscription`.

### 5.2 Usage metrics — exact contract

`usage` is the array behind every gauge. Supply one entry per key that the plan meaningfully limits:

| `key` | `used` is | `unit` | Where it appears |
| --- | --- | --- | --- |
| `employees` | active members occupying a seat | `seats` | Employees page, dashboard ring |
| `contacts` | stored contacts | `contacts` | Subscription ring, dashboard ring |
| `campaigns` | campaigns this billing period | `campaigns` | Subscription ring, dashboard ring |
| `whatsappAccounts` | connected numbers | `accounts` | Channels section |
| `emailAccounts` | connected sending identities | `accounts` | Channels section |
| `socialAccounts` | connected profiles | `accounts` | Channels section |
| `apiCalls` | API requests this period | `requests` | Platform usage, dashboard ring |
| `storage` | media and exports | `MB` | Subscription ring, dashboard ring |
| `messagesDaily` | messages sent in the rolling 24 h | `messages` | Platform usage |
| `messagesMonthly` | messages sent this period | `messages` | Platform usage |

```ts
interface UsageMetric {
  key: UsageMetricKey;
  label: string;               // human-readable, rendered verbatim, e.g. "Employee seats"
  used: number;
  limit: number | null;        // null = unlimited, rendered as ∞
  unit: string;
}
```

Rules that matter:

- **`limit: null` means unlimited.** Never send `0` for "no limit" — the client computes
  `used / limit` and a zero limit renders as 100 % used, firing a false "limit reached" state and an
  upgrade prompt.
- A genuine zero allowance (a Starter plan with `maxSocialAccounts: 0`) is legitimately `limit: 0` with
  `used: 0`. The client shows it as exhausted, which is correct — that plan cannot connect any.
- **`used` must be live.** These figures gate actions and drive prompts; a nightly aggregate will tell a
  user they are at their limit when they are not, or let them exceed it.
- `storage` is in **megabytes**. The client divides by 1024 to display GB.
- Thresholds are client-side: ≥ 75 % amber, ≥ 90 % orange, at or over the limit red.

### 5.3 Change plan

```
POST /api/v1/subscription/change-plan
```

```ts
interface ChangePlanRequest {
  planId: string;
  billingCycle: BillingCycle;
  effective?: 'immediate' | 'period_end';   // server decides by default, see below
}
```

Expected semantics:

- **Upgrade** — apply immediately, prorate the remainder of the current period, charge the difference.
- **Downgrade** — apply at `currentPeriodEnd` so the customer keeps what they paid for. Return the
  updated `SubscriptionSnapshot` with the pending change described.
- **Cycle switch** (monthly → yearly) — treat as an upgrade.

**Downgrade validation is the important part.** Reject with `409` when the target plan's limits are
below current usage, naming the offending metric:

```jsonc
{
  "title": "Downgrade blocked",
  "detail": "You have 18,420 contacts but the Starter plan allows 2,500. Remove contacts or choose a larger plan.",
  "errors": {}
}
```

Check every limit, not just the first — ideally list them all in `detail`. This is far kinder than
silently truncating data at the period boundary.

Return the full updated `SubscriptionSnapshot` so the client can refresh in one step.

Permission: `settings.subscription`. **Never available to `Employee`.**

### 5.4 Cancel, resume, auto-renew

```
POST /api/v1/subscription/cancel      { "reason"?: string, "immediate"?: boolean }
POST /api/v1/subscription/resume      {}
POST /api/v1/subscription/auto-renew  { "enabled": boolean }
```

- Cancel defaults to end-of-period: `autoRenew: false`, `status` stays `active` until `expiresAt`, then
  becomes `cancelled`. `immediate: true` ends it now and should prorate a refund if your billing model
  supports it.
- `resume` reverses a pending cancellation before `expiresAt`.
- Each returns the updated `SubscriptionSnapshot`.

The Subscription page shows auto-renew as a badge and warns when it is off within 14 days of expiry.

Permission: `settings.subscription`.

### 5.5 Trials

When `status` is `trial`, `trialEndsAt` must be non-null and `expiresAt` should equal it. On expiry,
move to `expired` and gate access — an expired subscription should return `403` from feature endpoints
with a `detail` the client can show, while leaving `/subscription`, `/plans` and `/billing/*` reachable
so the customer can pay.

Define whether a trial requires a payment method up front and tell us; it changes the checkout flow.

---

## 6. Plans (customer-facing)

```
GET /api/v1/plans
```

Returns `SubscriptionPlan[]` for the pricing page. **Exclude `archived`.** Include `inactive` only if
you want them visible — normally exclude those too.

Full `SubscriptionPlan` shape is in `API-REQUIREMENTS.md` §7.6. Points specific to this screen:

- `monthlyPrice` and `yearlyPrice` are both required on every plan; the toggle switches between them and
  the card shows a monthly-equivalent figure derived from `yearlyPrice / 12`.
- `highlights` is the bullet list. Order matters; render as sent.
- `limits` populates the comparison table — every one of the ten fields must be present, using `null`
  for unlimited.
- `modules` must contain all 8 keys, `true` or `false`.
- `isMostPopular` and `isRecommended` are independent ribbons. **At most one plan should carry each**;
  the UI does not enforce it and multiple ribbons look broken.
- `sortOrder` controls left-to-right ordering.

Available to any authenticated user. No permission required — an Employee may see pricing even though
they cannot buy.

---

## 7. Plan limit enforcement

The seat limit is the one this module owns directly.

- **Invite** — when `usage.employees.used >= plan.limits.maxEmployees`, return `422`:

  ```jsonc
  {
    "title": "Seat limit reached",
    "detail": "Your Growth plan includes 10 seats and all 10 are in use. Upgrade to add more.",
    "errors": {}
  }
  ```

  The client already renders an upgrade prompt from this response.

- Decide and document whether **invited** (not yet accepted) and **suspended** employees occupy seats.
  Our recommendation: invited **yes** (otherwise invitations can exceed the plan), suspended **no**
  (so a customer can suspend rather than delete). Whatever you choose, `usage.employees.used` must
  match it exactly — that number is what the gate and the gauge both read.

- **SuperAdmin exemption** — a Super Admin is never blocked by plan limits. When acting under `adminId`
  scope, still enforce the *scoped tenant's* limits for data integrity, but never refuse the Super Admin
  on the basis of their own account.

---

## 8. Billing

### 8.1 History

```
GET /api/v1/billing/history
```

```ts
interface BillingHistory {
  invoices: Invoice[];
  payments: Payment[];
  renewals: RenewalRecord[];
}
```

One call populates all three tabs. Newest first in each array. Full type definitions are in
`API-REQUIREMENTS.md` §7.6.

Client-side derivations you must keep consistent:

- **Outstanding** = sum of `amount + tax` over invoices with status `due` or `overdue`.
- **Paid to date** = sum of `amount` over payments with status `succeeded`.
- **Next charge** = `subscription.amount` on `subscription.nextRenewalAt`.
- A **failed-payment banner** appears when any payment has `status: "failed"`. Keep failures in the list
  after a successful retry — the banner clears because the retry succeeded, and the history stays honest.

If a tenant could accumulate more than ~100 invoices, add `page` / `pageSize` and tell us.

Permission: `settings.billing`.

### 8.2 Invoice PDF

```
GET /api/v1/billing/invoices/{id}/pdf
```

`Invoice.downloadUrl` currently carries a relative API path. Choose one and tell us:

1. **Signed URL** *(preferred)* — this endpoint returns `{ "downloadUrl": "https://…", "expiresAt": "…" }`
   and the client opens it directly. Works with a plain link, no auth header needed.
2. **Authenticated stream** — returns `application/pdf` with `Content-Disposition: attachment`. The
   browser will not attach the bearer token to a link, so the client must fetch as a blob. Workable, but
   it needs a small client change.

Either way `downloadUrl` on the invoice should point at whichever you implement.

Permission: `settings.billing`.

### 8.3 Retry a failed payment

```
POST /api/v1/billing/invoices/{id}/pay
```

Body `{}` — charges the default payment method. Optionally `{ "paymentMethodId": "pm_…" }`.

Returns the updated `BillingHistory` so the client can refresh all three tabs at once. Set `message` to
the outcome.

**Accept an `Idempotency-Key` header** and honour it. A user retrying a failed payment is exactly the
person likely to double-click.

On failure return `402` with the processor's reason in `detail` — that string is shown to the user, so
it should be human-readable, not a raw gateway code.

Permission: `settings.billing`.

### 8.4 Payment methods

Not yet built in the UI, but required before payments work end to end:

```
GET    /api/v1/billing/payment-methods            -> PaymentMethod[]
POST   /api/v1/billing/payment-methods            -> PaymentMethod   // token from the processor
DELETE /api/v1/billing/payment-methods/{id}       -> null
PUT    /api/v1/billing/payment-methods/{id}/default -> PaymentMethod
```

```ts
interface PaymentMethod {
  id: string;
  kind: 'card' | 'bank_transfer' | 'paypal';   // note the snake_case value
  brand: string | null;        // "Visa"
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
  createdAt: string;
}
```

**Card details must never reach our API or our database.** Use the processor's client-side tokenisation
(Stripe Elements or equivalent); we send you a token, you store the processor's reference. `last4` and
`brand` are display-only. The front end will not build a raw card form.

### 8.5 Billing address and tax

```
GET /api/v1/billing/profile   -> BillingProfile
PUT /api/v1/billing/profile   -> BillingProfile
```

Company name, address, country, VAT/tax id, billing email. Needed for compliant invoices; the UI for it
lands with workspace settings.

---

## 9. Permission matrix

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /employees`, `GET /permission-sets` | `settings.employees` | |
| All employee writes, all permission-set writes | `settings.employees` | Plus the escalation guards in §3.3 |
| `GET /subscription` | `settings.subscription` | |
| `POST /subscription/*` | `settings.subscription` | Never `Employee` |
| `GET /billing/history`, invoice PDF, retry, payment methods | `settings.billing` | Never `Employee` |
| `GET /plans` | none (authenticated) | Pricing is visible to everyone |

The whole Employees area is additionally gated on the plan including the `employees` module — a tenant
without it should receive `403` from every `/employees` and `/permission-sets` endpoint.

Subscription and Billing are **not** module-gated: a customer must always be able to see what they are
paying for and fix a failed payment, whatever their plan.

---

## 10. Consistency rules

1. `usage.employees.used` **equals** the number of employees from `GET /employees` that occupy a seat
   under your chosen rule (§7). These sit on the same screen.
2. `Employee.permissions` **equals** the `permissions` claim that person's token would carry.
3. `PermissionSet.assignedCount` **equals** the number of employees whose effective permissions match
   that set.
4. `subscription.planId` **equals** `plan.id` within the same snapshot.
5. `subscription.amount` **equals** `plan.monthlyPrice` or `plan.yearlyPrice` matching
   `subscription.billingCycle`, after any discount.
6. Outstanding, paid-to-date and next-charge are derived client-side from §8.1 — the underlying arrays
   must be complete and consistent, or the tiles contradict the tables beneath them.
7. Every usage figure is per tenant, and under `adminId` scoping it is the **scoped** tenant's.

---

## 11. Open questions

1. **Scoped Super Admin limits** — should a Super Admin viewing as an Admin see that Admin's real limits,
   or unlimited? The API should return real figures either way (§2); this decides a small client change.
2. **Seat accounting** — do invited and suspended employees occupy seats (§7)? Affects the gate and the
   gauge.
3. **Permission propagation** — short token lifetimes, or a token-version claim you bump on change
   (§3.3)? Determines whether we tell users their change is immediate.
4. **Payment processor** — which one, and does it support the proration model in §5.3? Stripe's
   subscription API gives upgrade/downgrade proration for free; a bespoke implementation is a large
   amount of work to get right.
5. **Trials** — payment method required up front? Changes the checkout flow and whether a trial can
   auto-convert.
6. **Invoice PDFs** — signed URL or authenticated stream (§8.2)?
7. **Refunds and credit notes** — in scope? `InvoiceStatus` already includes `refunded` and
   `PaymentStatus` includes `refunded`, but no endpoint issues one.
8. **Multiple Admins per workspace** — the model allows several `Admin` employees. Confirm that is
   intended, and that any Admin may change the plan and see billing. If billing should be restricted to
   an owner, we need an owner flag on `Employee`.
