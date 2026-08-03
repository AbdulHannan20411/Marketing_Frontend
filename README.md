# Marketing Frontend — Multi-Tenant WhatsApp Marketing SaaS

Enterprise multi-tenant WhatsApp Marketing SaaS platform. Enables campaign automation, contact
management and Meta template synchronisation via the official
[Meta WhatsApp Business Platform (Cloud API)](https://developers.facebook.com/docs/whatsapp/cloud-api).
Strictly tenant-isolated, role-based and production-shaped.

**This repository holds the front end.** Angular 19 (standalone components & signals) ·
Tailwind CSS 4 · ApexCharts · TypeScript (strict).
The backend — ASP.NET Core 10 Web API with PostgreSQL — is planned; see
[Backend](#backend) below.

---

## Quick start

Requires **Node.js 20.11+** (or 22+) and npm 10+.

```bash
npm --prefix web install
```

```bash
npm --prefix web run start
```

Then open <http://localhost:4200>.

The app boots against an in-memory mock backend, so **no API server is needed** to run it.

### Demo sign-ins

All three accounts use the password `Password1!`. The login screen has one-click buttons for each.

| Email | Role | What they can see |
| --- | --- | --- |
| `owner@verdant.io` | `TenantOwner` | Everything except the Platform section |
| `agent@verdant.io` | `TenantUser` | Read-mostly access; no settings or team management |
| `admin@verdant.io` | `PlatformAdmin` | Adds Tenants, Audit Logs and Monitoring |

Signing in as different roles is the fastest way to see the permission-driven navigation and
route guards at work.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm --prefix web run start` | Dev server with hot reload on port 4200 |
| `npm --prefix web run build` | Production build to `web/dist/web` |
| `npm --prefix web run watch` | Rebuild on change (development configuration) |
| `npm --prefix web test` | Unit tests via Karma |

To type-check without emitting:

```bash
npx --prefix web ng build --configuration development
```

---

## Project layout

```
Marketing_Project/
├─ CLAUDE.md              # Engineering standard: design tokens, contract, security rules
├─ README.md
├─ api/                   # Reserved for the ASP.NET Core 10 Web API
└─ web/                   # Angular 19 workspace
   └─ src/
      ├─ environments/    # environment.ts (mock on) + environment.production.ts
      └─ app/
         ├─ core/
         │  ├─ models/        # Domain + API types — no `any` anywhere
         │  ├─ auth/          # AuthService, token storage, JWT decoding
         │  ├─ guards/        # authGuard, guestGuard, permissionGuard
         │  ├─ interceptors/  # Bearer token + refresh retry, error normalisation
         │  ├─ services/      # ApiService and per-feature data services
         │  ├─ config/        # Permission-aware navigation definition
         │  └─ mock/          # Seeded dataset + mock backend interceptor
         ├─ shared/
         │  ├─ pipes/         # timeAgo, templateSegments
         │  └─ ui/            # Button, Card, Badge, Avatar, Skeleton, Toast,
         │                    # DataTable, StatCard, Chart, Icon, states
         ├─ layout/           # Shell, collapsible sidebar, top bar
         └─ features/         # One folder per module
```

---

## Architecture notes

### Multi-tenant isolation

**`TenantId` never reaches the client.** It is not in any model, request DTO, query string, or
local storage. Tenancy is resolved server-side from the access token's own claims; the JWT
interceptor attaches only `Authorization: Bearer <token>`. The `workspaceName` field that appears
in the UI is a display label, not a security identifier.

### Authorisation

Routes declare what they need and the guards enforce it:

```ts
{
  path: 'contacts',
  canActivate: [permissionGuard],
  data: { permissions: ['contacts.read'] },
  loadComponent: () => import('@features/contacts/contacts.component')
    .then((m) => m.ContactsComponent),
}
```

The same permission list drives the sidebar, so users are never shown a link that would bounce
them to `/forbidden`.

### Swapping in the real API

Every feature talks to `ApiService`, which prefixes `/api/v1/` and unwraps the `ApiResponse<T>`
envelope. The mock backend is a single HTTP interceptor gated on one flag:

```ts
// web/src/environments/environment.ts
export const environment: AppEnvironment = {
  useMockApi: true,   // ← set to false to hit the real backend
  apiBaseUrl: '/api/v1',
  // …
};
```

Production builds already use `environment.production.ts`, where the flag is `false`.

The mock dataset (`core/mock/mock-data.ts`) uses a seeded PRNG, so volumes, names and
distributions are identical on every reload — only timestamps move, and they are anchored to load
time so relative labels like "3 hours ago" stay truthful.

### Angular conventions

Standalone components throughout, `OnPush` change detection everywhere, signals and `computed()`
for state, `inject()` over constructor injection, built-in control flow (`@if` / `@for`), and
lazy-loaded routes. Strict TypeScript with `noUnusedLocals`; `any` is not used, including in
projected table templates (see `TableRowDirective`, which supplies an `ngTemplateContextGuard`).

---

## Design system

Light mode only — there is deliberately no dark theme.

| Token | Value |
| --- | --- |
| Background | `#FFFFFF` |
| Background (muted) | `#F6FFF8` |
| Primary | `#16A34A` |
| Accent | `#22C55E` |
| Border | `#E5E7EB` |

Tokens live in `web/src/styles.css` under Tailwind 4's `@theme` block, exposed as utilities like
`bg-brand-600` and `text-ink-muted`. Every page ships loading skeletons, empty states, error
states, keyboard-accessible controls and a responsive layout.

---

## Modules

| Module | Status |
| --- | --- |
| Authentication (login, forgot password, refresh, guards) | Built |
| Dashboard (KPIs, trend, funnel, delivery donut, activity) | Built |
| Contacts (search, filters, pagination, bulk selection) | Built |
| Groups · Tags | Built |
| WhatsApp connection (health, quality, messaging limit) | Built |
| Templates (preview, variable highlighting, Meta sync) | Built |
| Campaigns (metrics table, status filters) | Built |
| Reports (charts, failure log and breakdown) | Built |
| Admin — Tenants · Audit Logs · Monitoring | Built |
| Settings | Placeholder |
| Campaign Wizard · CSV import wizard | Not started |

Write actions (bulk tag, delete, disconnect) currently raise a toast rather than mutating — the
mock backend serves reads only.

---

## Backend

The `api/` directory is reserved for the ASP.NET Core 10 Web API (Clean Architecture, PostgreSQL).
Note that building it requires the **.NET 10 SDK**; a machine with only .NET 8 installed will not
compile it.

Until that exists, the front end runs entirely against its in-memory mock backend — see
[Swapping in the real API](#swapping-in-the-real-api).
