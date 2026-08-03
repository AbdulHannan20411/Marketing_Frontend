# Marketing Project — Multi-Tenant WhatsApp Marketing SaaS

Premium SaaS platform on the Meta WhatsApp Business Platform (Cloud API).
Quality bar: Stripe Dashboard / Linear / Vercel / Intercom. Never ship plain CRUD screens.

## Stack

- **Frontend:** Angular 19 — standalone components, signals, `computed()`, `effect()`, `inject()`,
  built-in control flow (`@if` / `@for` / `@switch`), `@defer`, Reactive Forms, RxJS, strict TypeScript.
- **Backend:** ASP.NET Core 10 Web API (Clean Architecture).
- **Styling:** Tailwind CSS 4. **Icons:** Heroicons. **Charts:** ApexCharts.
- **Change detection:** `OnPush` everywhere.

## Design System

Light mode only — never implement a dark theme.

| Token | Value |
| --- | --- |
| Background primary | `#FFFFFF` |
| Background secondary | `#F6FFF8` |
| Primary | `#16A34A` |
| Accent | `#22C55E` |
| Border | `#E5E7EB` |
| Text | slate-800 |
| Muted text | gray-500 |
| Success / Warning / Danger / Info | green / amber / red / emerald |

Cards: white, `rounded-xl`, soft shadow, hover elevation. Generous whitespace, clear hierarchy,
smooth transitions, fade-in page transitions, skeleton loaders.

## Non-negotiable UX per page

Loading skeleton · empty state · error state · success state · responsive (mobile + desktop) ·
keyboard accessible · WCAG AA contrast · hover animation.

## Layout

- **Top nav:** logo, search, notifications, user profile, settings, logout.
- **Sidebar:** collapsible, icon + label, active item on light-green background.
- **Content:** breadcrumb, page title, action buttons, filters, card-based body.

## Multi-Tenancy & Security

- `TenantId` is **never** sent from, stored in, or exposed to the client. It is resolved solely from
  the authenticated backend context (JWT claims).
- JWT interceptor attaches `Authorization: Bearer <token>`; refresh-token flow on 401.
- Roles: `PlatformAdmin`, `TenantOwner`, `TenantUser`.
- Route guards + permission guards; hide UI affordances the user lacks permission for.

## API

- Base URL `/api/v1/`, REST conventions.
- Strongly typed interfaces for every request/response. **`any` is forbidden.**
- Until the backend exists, `mockBackendInterceptor` serves every endpoint from a seeded
  in-memory dataset (`core/mock/mock-data.ts`). Set `useMockApi: false` in the environment to
  talk to the real API — no other change is needed.

## Running it

```bash
npm --prefix web run start
```

Demo sign-ins (mock only), all with password `Password1!`:
`owner@verdant.io` (TenantOwner) · `agent@verdant.io` (TenantUser) · `admin@verdant.io` (PlatformAdmin).

## Modules

Auth · Dashboard · Contacts (+ CSV import wizard, duplicate detection, bulk ops) · Groups · Tags ·
WhatsApp connection (Meta Embedded Signup) · Templates · Campaign Wizard (5 steps) · Reports ·
Admin Portal (tenants, audit logs, quotas, monitoring).

## Feature delivery contract

Every feature request is answered in **this exact order**, no section skipped:

1. Folder structure
2. Models (`*.model.ts`)
3. DTOs (if required)
4. Angular service (`*.service.ts`)
5. Component (`*.component.ts`)
6. HTML (`*.component.html`)
7. Tailwind styling
8. Route configuration
9. Route guard (if applicable)
10. Validation
11. Responsive behaviour
12. UX notes
13. Future improvements

## Code standards

Readonly properties · reusable UI primitives, no duplication · SOLID · smart folder organisation ·
enterprise naming.
