# Email Templates — Backend Requirements

**Status:** frontend done (Super Admin editor, mock API, shipped templates, unit tests).
Backend work needed: table, seed, 5 endpoints, one renderer, and switching the existing senders
over to the templates.

---

## 1. What this is

Every transactional email the platform sends gets a designed, branded template stored in the
database. Super Admins edit them in **Platform → Email templates** (`/superadmin/email-templates`)
with a live preview, send themselves a test, and can reset to the shipped version.

- **Platform-wide, not per tenant.** No `TenantId` column, no tenant filter.
- **Every email = layout + body.** `layout.base` holds the brand header, card and footer. Each
  other template is only the inner content. The server renders the body, then renders the layout
  with that result in `{{{content}}}`.
- **Email-safe HTML.** Tables, inline styles, 600px wide, a bulletproof table button. No CSS
  variables, no external CSS, no scripts. Colours are the app's design tokens as literals.

## 2. Files handed over

The frontend file `web/src/app/core/config/email-template-defaults.ts` is the source of truth. It is exported by:

```bash
node web/scripts/export-email-templates.mjs
```

| File | Use |
| --- | --- |
| `docs/email-templates/email-templates.seed.json` | **Seed from this.** Every template exactly as it should be stored (`key, name, description, category, subject, htmlBody, textBody, variables[]`). Embed it as a resource in `Marketing.DataAccess`. |
| `docs/email-templates/source/<key>.html` / `.txt` | The same bodies, one file each, to review in a diff |
| `docs/email-templates/preview/<key>.html` | Rendered with sample data. Open in a browser or send one through the dev mailbox to check the design. |

The export script checks every template against the rules in §5 and stops if one fails. A unit
test (`email-template-defaults.spec.ts`) checks the same thing.

## 3. Templates and where each one is sent

| Key | Replaces (current code) | Recipient | Variables (besides system ones) |
| --- | --- | --- | --- |
| `layout.base` | — | — | `subject`, `preheader` (optional), `content` |
| `auth.welcome` | **Nothing — not sent today.** See §8. | New workspace owner | `name`, `workspaceName`, `actionUrl` |
| `auth.invitation` | `AccountActivationService` invitation body (lines ~102–161) | Invited user | `name`, `inviterName`?, `inviterEmail`?, `workspaceName`, `actionUrl`, `expiresInHours` |
| `auth.password_reset` | `AccountActivationService.SendPasswordResetAsync` | User | `name`, `actionUrl`, `expiresInHours` |
| `auth.email_changed` | `AuthenticationService.NotifyAddressChangedAsync` (sent to the **previous** address) | User | `name`, `newEmail` |
| `billing.subscription_expiring` | `SubscriptionExpiryReminderService.SendEmailAsync` | Tenant admins | `name`, `planName`, `expiresIn` ("in 7 days"/"tomorrow" — your `wording`), `expiresOn` (`d MMMM yyyy`), `actionUrl` |
| `payments.submitted` | `PaymentNotifier` reviewer email | Each platform admin | `name`, `organisation`, `planName`, `amount` (`Money(request)`), `actionUrl` |
| `payments.approved` | `PaymentNotifier.ApprovedAsync` | Submitter | `name`, `amount`, `planName`, `activeUntil` (`periodEnd:d MMMM yyyy`), `actionUrl` |
| `payments.rejected` | `PaymentNotifier.RejectedAsync` | Submitter | `name`, `planName`, `reason` (verbatim), `actionUrl` |

`?` = optional. Pass an empty string, and the `{{#if}}` block drops out.

**System variables**, supplied to every template and to the layout:

| Name | Source |
| --- | --- |
| `appName` | `EmailOptions.FromName` |
| `appInitial` | First letter of `appName`, upper-cased (the logo mark) |
| `supportEmail` | **New option** `EmailOptions.SupportAddress` (fall back to `FromAddress`) |
| `clientBaseUrl` | `EmailOptions.ClientBaseUrl` without a trailing `/` |
| `year` | `IDateTimeProvider.UtcNow.Year` |

Keep existing behaviour: the invitation still sets `ReplyToAddress/ReplyToName` from the attribution.
Links are still built server-side (`BuildLink`, `Link(...)`), never from the request host.

## 4. Data model

```csharp
public sealed class EmailTemplate            // Marketing.DataAccess.Entities
{
    public long Id { get; set; }
    public string Key { get; set; } = "";          // unique, max 100, e.g. "auth.invitation"
    public string Name { get; set; } = "";         // max 100
    public string Description { get; set; } = "";  // max 300
    public string Category { get; set; } = "";     // "layout" | "account" | "billing" | "payments"
    public string Subject { get; set; } = "";      // max 200
    public string HtmlBody { get; set; } = "";     // nvarchar(max)
    public string TextBody { get; set; } = "";     // nvarchar(max)
    public string VariablesJson { get; set; } = "[]"; // [{name, description, sample}] from the seed
    public string DefaultHash { get; set; } = "";  // SHA-256 of subject+html+text as shipped
    public DateTimeOffset? UpdatedOn { get; set; }
    public long? UpdatedByUserId { get; set; }
}
```

- Unique index on `Key`. **Platform-scoped**: no tenant query filter.
- `isCustomised` in responses = the stored `Subject/HtmlBody/TextBody` differ from the shipped
  default. Compare against the embedded seed, or against `DefaultHash`, whichever you prefer.
- `Name`, `Description`, `Category`, `VariablesJson` are **not editable** through the API. They
  follow the code.

## 5. The template language — must match the frontend exactly

The preview renders in the browser, so the server must produce identical output. The reference
implementation is `web/src/app/core/models/email-template-renderer.ts`. Its spec
(`email-template-renderer.spec.ts`) works as a test list to port.

| Tag | Meaning |
| --- | --- |
| `{{name}}` | Value. In the **HTML body** it goes through `WebUtility.HtmlEncode`. In the **subject** and **text body** it is inserted as-is. |
| `{{{content}}}` | Raw insert. Allowed **only** in the layout's HTML and text bodies, **exactly once** in each. |
| `{{#if name}}…{{else}}…{{/if}}` | True when the value is non-blank (`!string.IsNullOrWhiteSpace`). `{{else}}` is optional. **No nesting.** |

- Names: `[A-Za-z][A-Za-z0-9_]*`. Whitespace inside the braces is allowed (`{{ name }}`).
- Tag regex (same as the frontend):
  `\{\{\{\s*(NAME)\s*\}\}\}|\{\{\s*(?:#if\s+(NAME)|(else)|(/if)|(NAME))\s*\}\}`
- A missing value renders as `""`.
- **Rendered subject**: replace `\s*[\r\n]+\s*` with a single space, then trim. This stops header
  injection from values like a workspace name. Keep your existing `Header()` control-character
  strip as well.
- Layout render: values + `subject` (the rendered subject) + `content` (the rendered body: HTML
  for the HTML layout, text for the text layout).

### Validation (on PUT and on test send) → 422 `validation_failed`

Return all problems at once, e.g. `errors: { "Template": ["…", "…"] }`. The editor already blocks
these, so a 422 only happens if someone calls the API directly.

1. Subject not blank, single line, ≤ 200 characters.
2. HTML body and text body not blank.
3. HTML body contains no `<script` (case-insensitive).
4. Parse problems in any field: unrecognised `{{…}}`, nested `#if`, unclosed `#if`, stray
   `else`/`/if`, more than one `else`.
5. Every variable used must be in: the template's own variables + system variables (+ `subject`,
   `preheader` for `layout.base`).
6. Triple braces anywhere except `{{{content}}}` in the layout bodies is an error.
7. Layout: `{{{content}}}` exactly once in HTML **and** once in text.

## 6. Endpoints

All under `[Authorize(Policy = AppConstants.Policies.SuperAdminOnly)]`, standard envelope
`{ data, message, traceId }`. There is no `adminId` scope, because these are platform data.

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/v1/superadmin/email-templates` | — | `EmailTemplateSummary[]` (no bodies), in seed order |
| GET | `/api/v1/superadmin/email-templates/{key}` | — | `EmailTemplate` |
| PUT | `/api/v1/superadmin/email-templates/{key}` | `{ subject, htmlBody, textBody }` | `EmailTemplate` (saved) |
| POST | `/api/v1/superadmin/email-templates/{key}/test` | `{ subject, htmlBody, textBody }` (**unsaved draft**) | `{ sentTo }` |
| POST | `/api/v1/superadmin/email-templates/{key}/reset` | — | `EmailTemplate` (back to shipped) |

```ts
EmailTemplateSummary = {
  key: string; name: string; description: string;
  category: 'layout' | 'account' | 'billing' | 'payments';
  subject: string; isCustomised: boolean;
  updatedAt: string | null;   // ISO 8601
  updatedBy: string | null;   // display name, not id or email
}
EmailTemplate = EmailTemplateSummary & {
  htmlBody: string; textBody: string;
  variables: { name: string; description: string; sample: string }[]; // own variables only
}
```

Errors: `404 email_template_not_found`, `422 validation_failed`, `409 email_template_no_default` (reset
on a key missing from the seed; should not happen).

**Test send**
- Renders the draft with each variable's `sample`, and system variables from real config.
- When testing a body, wrap it in the **saved** layout. When testing `layout.base`, wrap a short
  placeholder body in the **draft** layout.
- Sends **only to the signed-in Super Admin's own address**. There is no recipient field on purpose,
  so this cannot become a way to send arbitrary mail.
- Prefix the subject with `[Test] `.
- Goes through `IEmailSender` (the outbox) like everything else.
- Rate-limit it (e.g. 10/min per user).

**Audit**: write an audit-log entry for PUT and reset (`EmailTemplateUpdated`, `EmailTemplateReset`)
with the key. Leave the bodies out of the log.

## 7. Seeding

Add `SeedEmailTemplatesAsync` to `DatabaseSeeder.SeedAsync`, after the payment channels:

- **Insert** any key from the seed JSON that is missing.
- For existing rows, **always update** `Name`, `Description`, `Category`, `VariablesJson` and
  `DefaultHash`.
- **Update `Subject/HtmlBody/TextBody` only if the row is not customised** (still equals the
  previous default). A release can then improve a default without overwriting a Super Admin's edits.
- Never delete rows.

## 8. Rendering service (replacing hardcoded bodies)

```csharp
public interface IEmailTemplateRenderer
{
    Task<EmailMessage> RenderAsync(
        string key,
        string toAddress,
        string toName,
        IReadOnlyDictionary<string, string> values,
        CancellationToken cancellationToken = default);
}
```

- Loads the template + `layout.base`, adds system variables, renders (§5), returns an `EmailMessage`.
  Callers set `ReplyTo*` on it as they do today.
- Cache templates in memory (e.g. `IMemoryCache`, 5 min), and evict on PUT/reset.
- **Fallback:** if a template row is missing or fails to parse at send time, render from the
  embedded seed JSON and log a warning. A broken edit must never stop password resets.
- Replace the hardcoded HTML/text in the 6 call sites listed in §3 with `RenderAsync(...)`. The
  subjects move into the templates too.
- **Welcome email — new sending point.** `auth.welcome` is not sent anywhere today. Please send it
  once, when a new workspace owner finishes activating (after `accept-invitation` sets the password
  for an Admin, or after self-signup if you have one). Don't send it to employees; they already got
  the invitation. Please tell us which event you hook it to.

## 9. Questions for backend

1. **Support address.** Is there a real support mailbox? Add `Email:SupportAddress`; until then
   `supportEmail` falls back to `FromAddress` (a no-reply address in a "Need help?" footer is poor).
2. **Product name.** `FromName` defaults to "Marketing Platform"; the frontend samples say
   "NextReach". Which is the real brand name for production?
3. **Welcome trigger.** Which event (see §8)?
4. **Money / date formatting.** The templates receive already-formatted strings. Keep `Money(request)` and
   `d MMMM yyyy` as today, and use the same culture for every email.

## 10. Frontend reference

| File | Purpose |
| --- | --- |
| `core/models/email-template.model.ts` | Types, system/layout variables |
| `core/models/email-template-renderer.ts` | Language, renderer, validation (port this) |
| `core/config/email-template-defaults.ts` | Shipped templates (seed source) |
| `core/services/email-templates.service.ts` | The 5 calls above |
| `core/mock/mock-email-templates.ts` | Mock API: behaviour to copy, including 403 for non-Super-Admins |
| `features/superadmin/email-templates/*` | Editor UI |
