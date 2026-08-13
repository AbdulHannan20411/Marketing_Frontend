# Backend API Requirements

Contract the ASP.NET Core 10 Web API must satisfy for the Angular front end in this repository.

Everything here is derived from working front-end code — the HTTP calls in `web/src/app/core/services/`,
the TypeScript models in `web/src/app/core/models/`, and the in-memory stand-in
`web/src/app/core/mock/mock-backend.interceptor.ts`, which is the executable reference
implementation of this document.

**Definition of done:** setting `useMockApi: false` in `web/src/environments/environment.ts` makes the
application work against the real API with no other front-end change.

---

## 1. Conventions

### 1.1 Base URL and versioning

All endpoints live under `/api/v1/`. Paths in this document omit that prefix.

### 1.2 Response envelope

**Every successful response** is wrapped. The front end unwraps `data` centrally in `ApiService`, so an
unwrapped body will break every screen.

```jsonc
{
  "data":    { /* the payload, or null */ },
  "message": "Plan \"Growth\" saved.",   // optional, surfaced as a success toast; null when absent
  "traceId": "0HN7…"                     // correlation id, echoed in logs
}
```

`message` is displayed to the user when present. Use it for confirmations of writes; leave it `null`
for reads.

### 1.3 Error format

Errors use RFC 7807 Problem Details. The front end normalises them in `error.interceptor.ts`:

```jsonc
{
  "title":   "Validation failed",
  "detail":  "Contact limit reached for the current plan.",
  "errors":  { "email": ["Must be a valid address."] },   // field → messages
  "traceId": "0HN7…"
}
```

Status codes carry behaviour on the client:

| Status | Front-end behaviour |
| --- | --- |
| `401` | Triggers the refresh flow; a second failure signs the user out |
| `403` | Error toast; the user stays where they are |
| `422` | **No toast** — `errors` is rendered inline against form fields |
| `409` | Error toast; used for conflicts such as duplicate names |
| `429` | Error toast; include `Retry-After` |
| `5xx` | Error toast, generic copy |

Populate `errors` only for `400`/`422`.

### 1.4 JSON serialisation — three things that will break the client

1. **camelCase properties.** The .NET default (`JsonNamingPolicy.CamelCase`) is correct; do not change it.
2. **Enums as lowercase strings, not integers.** Register
   `JsonStringEnumConverter(JsonNamingPolicy.CamelCase)`. The client compares against exact string
   literals such as `"subscribed"`, `"marketing"`, `"approved"`. An integer enum breaks every badge and
   filter silently. One value is snake_case by design: `"bank_transfer"`.
3. **Dates as ISO 8601 UTC strings** (`2026-08-04T09:20:00Z`). The client parses with `new Date(...)` and
   renders relative times. `TrendPoint.date` is the exception: a date-only string, `YYYY-MM-DD`.

### 1.5 Numbers

Money is a decimal number of major units (`89`, `106.80`) — not minor units, not a string. `currency` is
a separate ISO 4217 code. Percentages are numbers where `98.2` means 98.2 %.

### 1.6 Pagination

Paged endpoints accept `page` (1-based) and `pageSize`, and return:

```jsonc
{ "items": [ … ], "page": 1, "pageSize": 12, "totalItems": 148, "totalPages": 13 }
```

`totalPages` must be at least `1` even when `totalItems` is `0`.

### 1.7 Identifiers

Opaque strings, never sequential integers exposed to the client. Existing prefixes:
`cnt_` contacts, `cmp_` campaigns, `tpl_` templates, `grp_` groups, `tag_` tags, `emp_` employees,
`plan_` plans, `inv_` invoices, `pay_` payments, `adm_` admin accounts, `tnt_` tenants, `ntf_`
notifications, `aud_` audit entries.

---

## 2. Authentication

### 2.1 Token flow

- Sign-in returns an access token and a refresh token.
- The client attaches `Authorization: Bearer <accessToken>` to every `/api/v1/` request.
- On `401`, the client calls `POST /auth/refresh` **once** (concurrent 401s share one refresh) and
  replays the original request. If refresh fails, the session is cleared.

### 2.2 Access token claims — required contract

The client decodes the JWT payload directly (`jwt.util.ts`) and drives navigation and authorisation
from it. These claims are mandatory:

```jsonc
{
  "sub":           "usr_amara",
  "email":         "admin@nextreach.io",
  "name":          "Amara Chen",
  "role":          "Admin",                       // SuperAdmin | Admin | Employee
  "permissions":   ["dashboard.view", "contacts.view", … ],  // see §4
  "workspaceName": "Northwind Retail",            // display label only
  "avatarUrl":     null,
  "iat":           1785000000,
  "exp":           1785001800
}
```

Notes:

- `permissions` must be the **effective** set for that user (role grant plus any per-user overrides).
  The client does not derive permissions from `role`.
- `workspaceName` is for display. It is **not** a tenant identifier and must not be trusted server-side.
- **No tenant claim may be readable as a tenant id by the client.** See §5.
- Suggested lifetimes: access token 15–30 minutes, refresh token 7–30 days with rotation.

### 2.3 Endpoints

| Method | Path | Body | Response `data` | Auth |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | `LoginRequest` | `AuthTokens` | Anonymous |
| POST | `/auth/refresh` | `{ refreshToken: string }` | `AuthTokens` | Anonymous |
| POST | `/auth/logout` | `{}` | `null` | Bearer |
| POST | `/auth/forgot-password` | `{ email: string }` | `null` | Anonymous |

```ts
interface LoginRequest  { email: string; password: string; rememberMe: boolean; }
interface AuthTokens    { accessToken: string; refreshToken: string; expiresAtUtc: string; }
```

Failed sign-in returns `401` with `title: "Sign-in failed"`. Do not reveal whether the email exists.
`/auth/forgot-password` always returns `200` for the same reason.

**Separate sign-in addresses.** The front end has two entrances, `/auth/login` and `/superadmin/login`,
and rejects an account that does not match the entrance it was used at. Today both call the same
endpoint and the check is client-side only — a UX boundary, not a security one. If you want it enforced,
add a `portal: "admin" | "superadmin"` field to `LoginRequest` and reject the mismatch server-side.
**Recommended**, since the client-side check alone is bypassable.

---

## 3. Roles

| Role | Scope |
| --- | --- |
| `SuperAdmin` | Platform-wide. Manages subscription plans and every Admin account. Exempt from all plan limits. |
| `Admin` | One organisation. Manages their own employees, contacts, campaigns and data. Views their own subscription but cannot create or edit plans. |
| `Employee` | Belongs to an Admin's organisation. Starts with a small permission grant that an Admin extends. |

Roles assign permissions in bulk; **authorise on permissions, never on role name**, with two exceptions
where role itself is the rule: access to `/superadmin/*` endpoints, and exemption from plan limits.

---

## 4. Permission catalogue

Authoritative list: `web/src/app/core/models/permission.model.ts`. Every string below is a valid value in
the `permissions` claim, and each maps to a UI affordance and a route guard.

**Dashboard** — `dashboard.view`, `dashboard.statistics`, `dashboard.export`

**Contacts** — `contacts.view`, `contacts.create`, `contacts.edit`, `contacts.delete`, `contacts.import`,
`contacts.export`, `groups.manage`, `tags.manage`

**WhatsApp** — `whatsapp.connect`, `whatsapp.disconnect`, `whatsapp.templates.view`,
`whatsapp.templates.sync`, `whatsapp.campaigns.create`, `whatsapp.campaigns.edit`,
`whatsapp.campaigns.delete`, `whatsapp.campaigns.schedule`, `whatsapp.campaigns.send`,
`whatsapp.campaigns.pause`, `whatsapp.campaigns.cancel`, `whatsapp.campaigns.reports`

**Email** — `email.connect`, `email.templates.manage`, `email.campaigns.create`, `email.campaigns.send`,
`email.analytics.view`

**Social** — `social.accounts.connect`, `social.posts.create`, `social.posts.schedule`,
`social.posts.publish`, `social.posts.delete`, `social.analytics.view`

**Reports** — `reports.view`, `reports.export`, `reports.download.csv`, `reports.download.excel`,
`reports.download.pdf`

**Settings** — `settings.company`, `settings.employees`, `settings.billing`, `settings.subscription`,
`settings.integrations`, `settings.apikeys`

**Platform (SuperAdmin only)** — `platform.tenants`, `platform.audit`, `platform.monitoring`,
`platform.plans`

The API must enforce these independently. The client hides controls the user lacks, but that is
convenience only — treat every request as if the UI did not exist.

---

## 5. Multi-tenancy — the hard rule, and its one exception

### 5.1 The rule

**The client never sends a tenant identifier, and no endpoint accepts one.** Resolve the tenant solely
from the authenticated principal's claims. Every query must be filtered by that tenant server-side.
`workspaceName` in the token is a display string and must never be used for data access.

### 5.2 The exception: Super Admin scoping

A Super Admin can view and manage the platform "as" a chosen Admin. That requires naming the target, so
one parameter is permitted:

```
GET /api/v1/contacts?adminId=adm_003
```

Rules the backend must enforce:

1. `adminId` identifies an **Admin account**, not a tenant. Resolve the tenant from the account yourself.
2. Honour it **only** when the caller's role is `SuperAdmin`. For any other role, ignore it and use the
   caller's own tenant — do not error, just ignore, so a forged parameter is inert.
3. Reject an unknown or unauthorised `adminId` with `403`.
4. Write it to the audit log: which Super Admin acted, on which account, and what changed.

The client attaches this automatically in `scope.interceptor.ts` when a Super Admin has selected an
Admin. Every endpoint marked **scopable** below must accept it.

---

## 6. Endpoint reference

Legend: **scopable** = accepts `?adminId=` per §5.2. Permissions listed are what the API must require.

### 6.1 Dashboard

| Method | Path | Query | Response `data` |
| --- | --- | --- | --- |
| GET | `/dashboard` | `adminId?` | `DashboardSnapshot` |

Scopable. Requires `dashboard.view`. Returns the last 30 days for the resolved tenant.

### 6.2 Contacts, groups and tags

| Method | Path | Query | Response `data` |
| --- | --- | --- | --- |
| GET | `/contacts` | `page`, `pageSize`, `search`, `status`, `groupId`, `adminId?` | `PagedResult<Contact>` |
| GET | `/groups` | `adminId?` | `ContactGroup[]` |
| GET | `/tags` | `adminId?` | `ContactTag[]` |

All scopable. `/contacts` requires `contacts.view`; `/groups` `groups.manage`; `/tags` `tags.manage`.

`status` accepts `all | subscribed | unsubscribed | blocked`; `groupId` accepts `all` or a group id.
`search` matches name, phone number and email, case-insensitively. Both filters default to `all` when
omitted. `ContactGroup.contactCount` and `ContactTag.contactCount` must be computed server-side and
consistent with what `/contacts` returns for the same filter.

### 6.3 WhatsApp and templates

| Method | Path | Query | Response `data` |
| --- | --- | --- | --- |
| GET | `/whatsapp/connection` | `adminId?` | `WhatsAppConnection` |
| POST | `/whatsapp/connection/sync` | `adminId?` | `WhatsAppConnection` |
| GET | `/templates` | `adminId?` | `MessageTemplate[]` |
| POST | `/templates/sync` | `adminId?` | `MessageTemplate[]` |

Scopable. Read requires `whatsapp.templates.view`; sync requires `whatsapp.templates.sync`; connection
changes require `whatsapp.connect` / `whatsapp.disconnect`.

The two `sync` endpoints call the Meta Cloud API and return the refreshed state. Both should set
`message` so the client can confirm ("Synced 9 templates from Meta.").

If no number is connected, return a `WhatsAppConnection` with `status: "disconnected"` — the client
renders a connect prompt. Do not return `404`.

### 6.4 Campaigns

| Method | Path | Query | Response `data` |
| --- | --- | --- | --- |
| GET | `/campaigns` | `adminId?` | `Campaign[]` |

Scopable. Requires `whatsapp.campaigns.reports` or `whatsapp.campaigns.create`.

Currently unpaged — the client filters and paginates in memory. **If a tenant may exceed ~200 campaigns,
tell us and we will move to `PagedResult<Campaign>`.**

### 6.5 Reports

| Method | Path | Query | Response `data` |
| --- | --- | --- | --- |
| GET | `/reports/overview` | `adminId?` | `DashboardSnapshot` |
| GET | `/reports/failures` | `page`, `pageSize`, `adminId?` | `PagedResult<DeliveryFailure>` |

Scopable. Require `reports.view`.

### 6.6 Subscription and billing (Admin-facing)

| Method | Path | Response `data` |
| --- | --- | --- |
| GET | `/subscription` | `SubscriptionSnapshot` |
| GET | `/plans` | `SubscriptionPlan[]` |
| GET | `/billing/history` | `BillingHistory` |

`/subscription` requires `settings.subscription`; `/billing/history` requires `settings.billing`;
`/plans` is available to any authenticated user (it drives the pricing page).

`/plans` returns only plans a customer may buy — exclude `archived`. `/subscription` returns the
caller's own subscription with **live usage counts**; the client renders every gauge and upgrade prompt
from `usage`, so figures must be current, not nightly.

`usage` must include one entry per `UsageMetricKey` the plan meaningfully limits. `limit: null` means
unlimited and is rendered as ∞.

### 6.7 Plan management (SuperAdmin only)

| Method | Path | Body | Response `data` |
| --- | --- | --- | --- |
| GET | `/admin/plans` | — | `SubscriptionPlan[]` |
| POST | `/admin/plans` | `PlanDraft` | `SubscriptionPlan` |
| PUT | `/admin/plans/{id}` | `Partial<PlanDraft>` | `SubscriptionPlan` |
| POST | `/admin/plans/{id}/duplicate` | `{}` | `SubscriptionPlan` |
| DELETE | `/admin/plans/{id}` | — | `null` |

All require `platform.plans` **and** role `SuperAdmin`. `GET /admin/plans` includes `inactive` and
`archived` plans, unlike `/plans`.

`PUT` is a partial update — the client sends only changed fields, and status changes
(activate/deactivate/archive) are sent as `{ "status": "inactive" }`. Apply patch semantics.

`duplicate` copies the source plan with a new id, name suffixed `" (copy)"`, `status: "inactive"`, and
both badge flags cleared.

`DELETE` must not orphan existing subscribers: keep their current terms and stop offering the plan.
Return `409` if your model cannot honour that.

`PlanDraft` is `SubscriptionPlan` without `id` and `updatedAt` — both server-owned.

### 6.8 Employees and permissions

| Method | Path | Query | Response `data` |
| --- | --- | --- | --- |
| GET | `/employees` | `adminId?` | `Employee[]` |
| GET | `/permission-sets` | `adminId?` | `PermissionSet[]` |

Scopable. Require `settings.employees`.

`Employee.permissions` is that person's effective grant and must match what their token would carry.

### 6.9 Notifications

| Method | Path | Response `data` |
| --- | --- | --- |
| GET | `/notifications` | `AppNotification[]` |
| POST | `/notifications/{id}/read` | `AppNotification[]` |
| POST | `/notifications/read-all` | `AppNotification[]` |

Any authenticated user; scoped to the caller. Both writes return the **full updated list** so the client
can replace its state in one step.

Newest first. The client caps the topbar dropdown at 5. Return at most ~50; add paging if you expect
more and tell us.

### 6.10 Global search

| Method | Path | Query | Response `data` |
| --- | --- | --- | --- |
| GET | `/search` | `q`, `adminId?` | `SearchResultGroup[]` |

Scopable. Results must respect the caller's permissions — never return a contact to someone without
`contacts.view`.

Return groups in this order, each capped at 4: `contact`, `campaign`, `template`, `employee`, `report`,
`subscription`, `setting`. Omit empty groups. Empty `q` returns `[]`. Target < 200 ms.

### 6.11 Platform administration (SuperAdmin only)

| Method | Path | Query | Response `data` |
| --- | --- | --- | --- |
| GET | `/superadmin/admins` | — | `AdminAccount[]` |
| GET | `/superadmin/overview` | — | `PlatformOverview` |
| GET | `/admin/tenants` | `page`, `pageSize` | `PagedResult<Tenant>` |
| GET | `/admin/audit` | `page`, `pageSize` | `PagedResult<AuditLogEntry>` |
| GET | `/admin/system` | — | `SystemSnapshot` |

Require role `SuperAdmin`, plus `platform.tenants`, `platform.audit` and `platform.monitoring`
respectively. `/superadmin/overview` aggregates across every Admin.

---

## 7. Type definitions

TypeScript is the source of truth; map to C# records with camelCase JSON. Enum unions become string
enums — see §1.4.

### 7.1 Shared

```ts
interface ApiResponse<T>  { data: T; message: string | null; traceId: string; }
interface PagedResult<T>  { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number; }
```

### 7.2 Dashboard and analytics

```ts
interface DashboardSnapshot {
  kpis: KpiSummary;
  trend: TrendPoint[];        // 30 entries, oldest first
  funnel: FunnelStage[];      // Sent, Delivered, Read, Clicked
  activity: ActivityEntry[];
}

interface KpiSummary {
  messagesSent: number; delivered: number; read: number; failed: number;
  clickThroughRate: number;                 // 15.7 means 15.7 %
  messagesSentDelta: number;                // % change vs the previous 30 days; may be negative
  deliveredDelta: number; readDelta: number; failedDelta: number; clickThroughRateDelta: number;
}

interface TrendPoint   { date: string; sent: number; delivered: number; read: number; }  // date: YYYY-MM-DD
interface FunnelStage  { label: string; value: number; }

interface ActivityEntry {
  id: string; actor: string; actorInitials: string;
  action: string;      // verb phrase, e.g. "launched campaign"
  subject: string;     // e.g. "Loyalty Points Reminder"
  occurredAt: string;
}
```

### 7.3 Contacts

```ts
type ContactStatus = 'subscribed' | 'unsubscribed' | 'blocked';
type TagColor      = 'brand' | 'info' | 'warning' | 'danger' | 'neutral';

interface Contact {
  id: string; fullName: string; initials: string;
  phoneNumber: string;              // E.164, may carry display spacing
  email: string | null; country: string;
  status: ContactStatus;
  tagIds: string[]; groupIds: string[];
  optedInAt: string | null; lastMessagedAt: string | null; createdAt: string;
}

interface ContactGroup { id: string; name: string; description: string; contactCount: number; createdAt: string; updatedAt: string; }
interface ContactTag   { id: string; name: string; color: TagColor; contactCount: number; createdAt: string; }
```

### 7.4 WhatsApp

```ts
type ConnectionStatus = 'connected' | 'disconnected' | 'pending' | 'error';
type QualityRating    = 'green' | 'yellow' | 'red';
type TemplateStatus   = 'approved' | 'pending' | 'rejected' | 'paused';
type TemplateCategory = 'marketing' | 'utility' | 'authentication';

interface WhatsAppConnection {
  status: ConnectionStatus;
  displayPhoneNumber: string; verifiedName: string;
  businessProfileAbout: string; businessCategory: string;
  qualityRating: QualityRating;
  messagingLimit: number; messagesLast24h: number;    // rolling 24-hour ceiling and usage
  connectedAt: string | null; webhookHealthy: boolean;
  templateNamespaceAlias: string;
}

interface MessageTemplate {
  id: string; name: string;
  category: TemplateCategory; status: TemplateStatus;
  language: string;                    // e.g. "en_GB"
  headerText: string | null;
  bodyText: string;                    // keep {{1}} placeholders intact — the client highlights them
  footerText: string | null;
  variables: string[];                 // ordered; variables[0] fills {{1}}
  buttons: string[];
  qualityScore: QualityRating; timesUsed: number;
  updatedAt: string; rejectionReason: string | null;
}
```

### 7.5 Campaigns

```ts
type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'paused' | 'failed';

interface CampaignMetrics { audienceSize: number; sent: number; delivered: number; read: number; clicked: number; failed: number; }

interface Campaign {
  id: string; name: string; templateName: string;
  status: CampaignStatus; metrics: CampaignMetrics;
  audienceLabel: string;               // human-readable, e.g. "Loyalty members"
  scheduledAt: string | null; completedAt: string | null;
  createdBy: string; createdAt: string;
}

interface DeliveryFailure {
  id: string; campaignName: string; contactName: string; phoneNumber: string;
  reason: string;                      // human-readable, e.g. "Invalid phone number"
  errorCode: number;                   // Meta code, e.g. 131026
  occurredAt: string;
}
```

### 7.6 Subscription and billing

```ts
type BillingCycle       = 'monthly' | 'yearly';
type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'suspended' | 'cancelled';
type SupportLevel       = 'community' | 'email' | 'priority' | 'dedicated';
type PlanStatus         = 'active' | 'inactive' | 'archived';
type FeatureModule      = 'whatsapp' | 'email' | 'social' | 'crm' | 'reporting' | 'ai' | 'api' | 'employees';

interface PlanLimits {          // null everywhere means unlimited
  maxEmployees: number | null; maxContacts: number | null; maxCampaigns: number | null;
  maxWhatsAppAccounts: number | null; maxEmailAccounts: number | null; maxSocialAccounts: number | null;
  maxApiCallsPerMonth: number | null; maxStorageMb: number | null;
  dailyMessageLimit: number | null; monthlyMessageLimit: number | null;
}

type PlanModules = Record<FeatureModule, boolean>;   // all 8 keys required

interface SubscriptionPlan {
  id: string; name: string; tagline: string;
  monthlyPrice: number; yearlyPrice: number; currency: string;
  trialDays: number; renewalPeriodMonths: number;
  discountPercent: number; isPromotional: boolean;
  isMostPopular: boolean; isRecommended: boolean;
  status: PlanStatus; supportLevel: SupportLevel;
  modules: PlanModules; limits: PlanLimits;
  highlights: string[];               // marketing bullets
  sortOrder: number; updatedAt: string;
}

interface Subscription {
  planId: string; planName: string;
  status: SubscriptionStatus; billingCycle: BillingCycle;
  currentPeriodStart: string; currentPeriodEnd: string;
  nextRenewalAt: string | null; expiresAt: string;
  autoRenew: boolean; trialEndsAt: string | null;
  seatsPurchased: number; amount: number; currency: string;
}

type UsageMetricKey =
  | 'employees' | 'contacts' | 'campaigns' | 'whatsappAccounts' | 'emailAccounts'
  | 'socialAccounts' | 'apiCalls' | 'storage' | 'messagesDaily' | 'messagesMonthly';

interface UsageMetric { key: UsageMetricKey; label: string; used: number; limit: number | null; unit: string; }

interface SubscriptionSnapshot { subscription: Subscription; plan: SubscriptionPlan; usage: UsageMetric[]; }
```

```ts
type InvoiceStatus     = 'paid' | 'due' | 'overdue' | 'refunded' | 'void';
type PaymentStatus     = 'succeeded' | 'failed' | 'pending' | 'refunded';
type PaymentMethodKind = 'card' | 'bank_transfer' | 'paypal';   // note the snake_case value

interface Invoice {
  id: string; number: string; planName: string; billingCycle: BillingCycle;
  amount: number; tax: number; currency: string;   // client displays amount + tax
  status: InvoiceStatus;
  issuedAt: string; dueAt: string; paidAt: string | null;
  periodStart: string; periodEnd: string;
  downloadUrl: string;                              // see §9.2
}

interface Payment {
  id: string; invoiceNumber: string; amount: number; currency: string;
  status: PaymentStatus; method: PaymentMethodKind;
  cardBrand: string | null; cardLast4: string | null;   // last 4 only — never a full PAN
  processedAt: string; failureReason: string | null;
}

interface RenewalRecord {
  id: string; planName: string; billingCycle: BillingCycle;
  amount: number; currency: string;
  renewedAt: string; periodEnd: string; automatic: boolean;
}

interface BillingHistory { invoices: Invoice[]; payments: Payment[]; renewals: RenewalRecord[]; }
```

### 7.7 Employees

```ts
type EmployeeStatus = 'active' | 'invited' | 'suspended';

interface Employee {
  id: string; name: string; initials: string; email: string; jobTitle: string;
  role: 'SuperAdmin' | 'Admin' | 'Employee';
  status: EmployeeStatus;
  permissions: string[];              // effective grant
  lastActiveAt: string | null; invitedAt: string;
}

interface PermissionSet {
  id: string; name: string; description: string;
  isSystem: boolean;                  // system sets cannot be deleted
  permissions: string[]; assignedCount: number;
}
```

### 7.8 Notifications

```ts
type NotificationPriority = 'critical' | 'warning' | 'info' | 'success';

type NotificationKind =
  | 'subscription.expiring' | 'meta.disconnected' | 'whatsapp.token.expiring'
  | 'campaign.completed' | 'campaign.failed' | 'payment.received' | 'payment.failed'
  | 'employee.invited' | 'plan.upgraded' | 'storage.limit' | 'contacts.limit' | 'messages.limit';

interface AppNotification {
  id: string; kind: NotificationKind; title: string; body: string;
  priority: NotificationPriority;
  icon: string;                        // icon key, see §9.3
  read: boolean;
  actionLabel: string | null; actionRoute: string | null;   // in-app route, e.g. "/billing"
  occurredAt: string;
}
```

### 7.9 Search

```ts
type SearchResultKind = 'contact' | 'campaign' | 'template' | 'employee' | 'report' | 'subscription' | 'setting';

interface SearchResult      { id: string; kind: SearchResultKind; title: string; subtitle: string; icon: string; route: string; }
interface SearchResultGroup { kind: SearchResultKind; label: string; results: SearchResult[]; }
```

### 7.10 Platform administration

```ts
type TenantPlan   = 'starter' | 'growth' | 'scale' | 'enterprise';
type TenantStatus = 'active' | 'trialing' | 'suspended';

interface AdminAccount {
  id: string; name: string; initials: string; email: string; organisation: string;
  plan: TenantPlan; status: TenantStatus;
  employeeCount: number; contactCount: number; campaignCount: number;
  leadCount: number; customerCount: number; messagesThisMonth: number;
  lastActiveAt: string; createdAt: string;
}

interface PlatformOverview {
  totalAdmins: number; activeAdmins: number; totalEmployees: number;
  totalCampaigns: number; totalLeads: number; totalCustomers: number;
  totalContacts: number; totalMessagesThisMonth: number;
  messagesDelta: number; customersDelta: number; leadsDelta: number; campaignsDelta: number;
  trend: { date: string; messages: number; customers: number }[];
  planBreakdown: { plan: TenantPlan; adminCount: number; monthlyRevenue: number }[];
  topAdmins: { adminId: string; name: string; organisation: string; messagesThisMonth: number; deliveryRate: number }[];
}

interface Tenant {
  id: string; name: string; ownerEmail: string;
  plan: TenantPlan; status: TenantStatus;
  seats: number; messagesThisMonth: number; messageQuota: number; createdAt: string;
}

type AuditSeverity = 'info' | 'warning' | 'critical';

interface AuditLogEntry {
  id: string; actor: string; actorInitials: string;
  action: string; target: string; workspace: string;
  ipAddress: string; severity: AuditSeverity; occurredAt: string;
}

interface SystemSnapshot {
  services: { name: string; status: 'operational' | 'degraded' | 'outage'; uptimePercent: number; latencyMs: number }[];
  quotas:   { label: string; used: number; limit: number; unit: string }[];
  throughput: { label: string; value: number }[];      // 24 hourly buckets, label "00:00"
}
```

---

## 8. Endpoints required but not yet called

The UI for these exists and currently raises a "not wired up" toast. **Build them** — they complete the
product, and the front-end work to consume them is small.

### 8.1 Contacts

| Method | Path | Body | Permission |
| --- | --- | --- | --- |
| POST | `/contacts` | `CreateContactRequest` | `contacts.create` |
| PUT | `/contacts/{id}` | `UpdateContactRequest` | `contacts.edit` |
| DELETE | `/contacts/{id}` | — | `contacts.delete` |
| POST | `/contacts/bulk-delete` | `{ ids: string[] }` | `contacts.delete` |
| POST | `/contacts/bulk-tag` | `{ ids: string[]; tagIds: string[] }` | `contacts.edit` |
| POST | `/contacts/bulk-group` | `{ ids: string[]; groupIds: string[] }` | `contacts.edit` |
| POST | `/contacts/import` | multipart CSV | `contacts.import` |
| GET | `/contacts/export` | — | `contacts.export` |

The import wizard needs a two-step flow: upload returns a **preview** with detected columns, a sample of
parsed rows, and duplicate detection by phone number; a second call commits with a column mapping.

### 8.2 Groups, tags, campaigns, templates

Standard `POST` / `PUT` / `DELETE` on `/groups/{id}`, `/tags/{id}`, `/campaigns/{id}`, `/templates/{id}`,
each behind the matching permission. Campaigns additionally need lifecycle actions:
`POST /campaigns/{id}/schedule`, `/send`, `/pause`, `/cancel`.

### 8.3 Employees and permissions

| Method | Path | Body | Permission |
| --- | --- | --- | --- |
| POST | `/employees/invite` | `{ email, name, jobTitle, permissions }` | `settings.employees` |
| PUT | `/employees/{id}/permissions` | `{ permissions: string[] }` | `settings.employees` |
| PUT | `/employees/{id}/status` | `{ status: EmployeeStatus }` | `settings.employees` |
| DELETE | `/employees/{id}` | — | `settings.employees` |
| POST/PUT/DELETE | `/permission-sets{/id}` | `PermissionSet` | `settings.employees` |

Enforce the plan's `maxEmployees` on invite: `422` with a message naming the limit. Changing permissions
must invalidate or refresh that employee's token so the change takes effect promptly.

### 8.4 Subscription lifecycle

| Method | Path | Body |
| --- | --- | --- |
| POST | `/subscription/change-plan` | `{ planId, billingCycle }` |
| POST | `/subscription/cancel` | `{ reason? }` |
| POST | `/subscription/auto-renew` | `{ enabled: boolean }` |
| POST | `/billing/invoices/{id}/pay` | `{}` — retry a failed payment |
| GET | `/billing/invoices/{id}/pdf` | — |

Upgrades apply immediately; downgrades at period end. Reject a downgrade whose limits are below current
usage with `409` and a message naming the offending metric.

### 8.5 Admin account management (SuperAdmin)

`POST /superadmin/admins`, `PUT /superadmin/admins/{id}`, `DELETE /superadmin/admins/{id}`, and
`PUT /superadmin/admins/{id}/status` for suspend/reactivate. All require role `SuperAdmin`.

---

## 9. Non-functional requirements

### 9.1 Performance

`/dashboard`, `/subscription` and `/search` are on the critical path — target < 300 ms at p95. The
dashboard aggregates 30 days of data; pre-aggregate rather than scanning the message log per request.

### 9.2 File downloads

`Invoice.downloadUrl` is currently a relative API path. Either serve it behind bearer auth, or return a
short-lived signed URL. **Prefer the signed URL** — the browser follows the link directly and will not
attach the `Authorization` header. Say which you choose; the client may need a small change.

### 9.3 Icon keys

`AppNotification.icon` and `SearchResult.icon` must be keys from the client's registry
(`web/src/app/shared/ui/icon/icon.registry.ts`) — e.g. `creditCard`, `send`, `warning`, `checkCircle`,
`users`, `chat`, `database`, `shield`, `trendingUp`, `xCircle`, `megaphone`, `document`, `userGroup`,
`chartBar`, `cog`, `bell`, `sparkles`, `rocket`. An unknown key renders nothing. If you would rather
send a semantic value, tell us and we will map it client-side.

### 9.4 Real-time

Notifications are currently fetched once per page load. If you expose SignalR or SSE we will subscribe;
otherwise we will poll. State your preference — it affects §6.9.

### 9.5 CORS, rate limiting, audit

- CORS: allow the SPA origin with credentials; `Authorization` and `Content-Type` headers.
- Rate limiting: return `429` with `Retry-After`. `/auth/login` should be throttled per IP and per account.
- Audit: log every write with actor, tenant, target and outcome — plus the acting Super Admin whenever a
  request carried `adminId` (§5.2).

### 9.6 Idempotency

Accept an `Idempotency-Key` header on payment and campaign-send endpoints so a retried request cannot
double-charge or double-send.

---

## 10. Open questions for the backend team

1. Should `/campaigns` be paged? Depends on expected per-tenant volume (§6.4).
2. Signed URLs or authenticated streaming for invoice PDFs (§9.2)?
3. SignalR, SSE, or polling for notifications (§9.4)?
4. Are Leads and Customers real entities, or derived from contacts? `PlatformOverview` reports both, but
   no module exposes them yet — if they are real, they need their own endpoints and models.
5. Will you add `portal` to `LoginRequest` so the separate Super Admin sign-in is enforced server-side
   rather than only in the client (§2.3)?
6. Is `adminId` scoping acceptable to your security model, or would you prefer a short-lived
   impersonation token minted by a dedicated endpoint? The latter is stronger; the client change is
   contained to one interceptor.
