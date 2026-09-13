# Email Templates — Backend Notes

Response to *Email Templates — Backend Requirements*. The backend is built to that spec: table, seed,
the five endpoints, the renderer, and every sender switched over. This covers what matches, the
places it deliberately differs, and answers to §9.

---

## 1. Endpoints — as specified

All under `/api/v1/superadmin/email-templates`, Super Admin only, standard envelope, no `adminId`.

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/` | `EmailTemplateSummary[]`, in seed order |
| `GET` | `/{key}` | `EmailTemplate` |
| `PUT` | `/{key}` | `EmailTemplate` (saved) |
| `POST` | `/{key}/test` | `{ sentTo }` |
| `POST` | `/{key}/reset` | `EmailTemplate` (shipped wording) |

Shapes match `email-template.model.ts` field for field. `category` is the plain string you listed.

| Status | `errorCode` | When |
| --- | --- | --- |
| `404` | `email_template_not_found` | Unknown key |
| `422` | `validation_failed` | Draft would not render — every problem under `errors.Template` |
| `409` | `email_template_no_default` | Reset on a key with no shipped default |
| `429` | — | Test sends over 10 a minute for one user |

The 422 messages are your `validateDraft` messages, verbatim and in the same order.

---

## 2. The template language — ported, with a test that holds it to the spec

`EmailTemplateLanguage` is a line-for-line port of `email-template-renderer.ts`: same tag regex, same
parse and validation rules, same problem wording. `email-template-renderer.spec.ts` is ported case
for case to `EmailTemplateLanguageTests`, and all of it passes.

Three further tests run against the seed itself:

- every shipped template validates under its own rules
- every shipped email renders inside the layout with its samples and leaves no `{{` behind
- the layout ships first and every key is unique

**Two differences, both invisible in practice:**

- **HTML encoding** uses `WebUtility.HtmlEncode`, as the spec says. As your renderer notes, that also
  writes U+00A0–U+00FF as numeric entities. The bytes differ; the rendering does not.
- **The sent subject also has control characters stripped** after line breaks are flattened, as you
  asked (the old `Header()` behaviour). The preview does not do this, so a tab in a value would show
  in the preview and not in the inbox. Validation already refuses line breaks in the subject itself.

---

## 3. Behaviour to know about

### `updatedAt` / `updatedBy`

Stay `null` until a person saves or resets through the editor. Stored in their own columns, not the
audit columns every entity has — those are stamped on *any* write, including a release refreshing a
default, and "last edited" would then name a change nobody made. `updatedBy` is the display name.

### `isCustomised`

Compared against the shipped default itself — subject, HTML and text — exactly as your mock does.

### Test send

- Goes only to the signed-in Super Admin's own address, through the outbox, subject prefixed `[Test] `.
- **Body templates** are wrapped in the **saved** layout.
- **The layout** wraps your `LAYOUT_PREVIEW_BODY` — copied exactly — with the preheader sample
  `Your workspace is ready.`, so a test looks like the preview the person was just looking at.
- Variables use their samples; **system variables use real configuration**. Expect the configured
  product name in a test email, not the "NextReach" your samples use — see §5.

### A broken template can never stop an email

When a stored template is missing or fails to parse at send time, the shipped default from the
embedded seed is used instead and a warning is logged. The API refuses such a template on save, so
this only covers the database being changed some other way.

### Caching

Resolved templates are cached in memory for 5 minutes. Save and reset evict immediately on the
instance that handled them. **With more than one API instance, another instance can serve the old
wording for up to 5 minutes** — acceptable for email copy, but not instant everywhere.

### Seeding

Runs at startup, as specified: missing keys inserted; name, description, category and variables always
refreshed; wording replaced only when nobody has edited it; nothing deleted. A release can therefore
improve a default without overwriting a Super Admin's edit.

---

## 4. One deliberate difference from the spec — audit

You asked for audit entries named `EmailTemplateUpdated` and `EmailTemplateReset`. They are not
written, because audit here is automatic: an interceptor records every entity change in the same
transaction as the change. A save and a reset each already produce an `EmailTemplate` / `Updated` row
with who, when, and which fields changed.

Writing named entries as well would put two rows in the log for every edit. **The bodies are redacted**
from that automatic record, as you asked — by property name, so queued outbox messages are covered too.

The cost: a reset is not labelled as one. It shows as an update whose subject and bodies returned to
the default. Say if the distinction matters and it can be added, but it means a new audit action value
that your audit screen would need to handle.

---

## 5. Answers to §9

**1. Support address.** Added `Email:SupportAddress` — optional, validated as an address when set. Until
it is, `supportEmail` falls back to `FromAddress`. **Whether a real support mailbox exists is a
business decision the backend cannot make.** Set it before launch; you're right that a no-reply
address in a "Need help?" footer is poor.

**2. Product name.** It is whatever `Email:FromName` is configured as — currently "Marketing Platform".
The backend does not choose the brand. Once the name is decided, set it in configuration and every
email and test send picks it up; no code change.

**3. Welcome trigger.** Sent when **a workspace's first administrator accepts their invitation** — the
acceptance that moves the workspace from `Pending` to `Active`. That is precisely "a new owner finishes
activating": employees join a workspace that is already active, so they are never welcomed twice.

There is no self-signup in the backend, so this is the only trigger. It runs after the account is
saved, and a failure is logged, never raised — a mail problem must not tell a new owner their sign-up
failed. The link goes to `{clientBaseUrl}/dashboard`, matching the seed's sample.

**4. Money and dates.** Every email uses the invariant culture: dates as `d MMMM yyyy`, amounts as
`CUR 1,234`. The amount helper is shared with in-app notifications, so those are now invariant too —
the same amount reads the same everywhere, whatever culture the host runs under.

---

## 6. Senders switched

| Template | Sent by | Notes |
| --- | --- | --- |
| `auth.invitation` | Invitation | Reply-to still the inviter |
| `auth.password_reset` | Password reset | |
| `auth.email_changed` | Profile update | Still sent to the **previous** address |
| `auth.welcome` | Invitation acceptance | **New** — see §5.3 |
| `billing.subscription_expiring` | Expiry reminders | `expiresIn` uses the existing wording |
| `payments.submitted` | Payment submitted | One per platform administrator |
| `payments.approved` | Payment approved | `activeUntil` = period end |
| `payments.rejected` | Payment rejected | `reason` verbatim |

Subjects moved into the templates with the bodies. Links are still built from configuration, never
from the request.

---

## 7. Not yet verified live

Build is clean, unit tests and the route-table test pass, and the migration is in. **The endpoints and
the startup seed have not been exercised against a running API yet.** Checks worth doing once it is up:

- `GET /superadmin/email-templates` returns nine templates, layout first, none customised
- a test send arrives with the configured product name and `[Test] ` in the subject
- save, then reset, flips `isCustomised` and sets `updatedBy`
