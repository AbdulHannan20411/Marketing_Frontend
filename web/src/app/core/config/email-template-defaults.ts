import type { EmailTemplate } from '@core/models/email-template.model';
import { EMAIL_LAYOUT_KEY } from '@core/models/email-template.model';

/**
 * The shipped email templates — the source the backend seeds its database from.
 *
 * **Email-safe HTML, not the app's CSS.** Email clients support neither CSS
 * variables, nor Tailwind, nor external stylesheets, and Outlook still lays out
 * with Word's engine. "Same theme" therefore means the same colours, type,
 * spacing and brand mark, written as inline styles on table layouts. The values
 * below are the design tokens from `styles.css`, copied as literals on purpose.
 *
 * The light theme only: dark-mode support in email is inconsistent enough that
 * a forced light palette is more predictable than a half-inverted one.
 *
 * Exported to `docs/email-templates/` for the backend seed by
 * `node web/scripts/export-email-templates.mjs` — see `docs/API-EMAIL-TEMPLATES.md`.
 * Edit here, then re-export; never edit the exported files.
 */

export type EmailTemplateDefault = Omit<EmailTemplate, 'isCustomised' | 'updatedAt' | 'updatedBy'>;

/* ------------------------------------------------------------------ *
 * Design tokens (from styles.css)
 * ------------------------------------------------------------------ */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BRAND = '#16a34a';
const BRAND_700 = '#15803d';
const BRAND_50 = '#f0fdf4';
const INK = '#1e293b';
const SOFT = '#475569';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const CANVAS = '#f6fff8';
const SUNKEN = '#f9fafb';

const TONES = {
  success: { background: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
  warning: { background: '#fffbeb', border: '#fde68a', text: '#92400e' },
  danger: { background: '#fef2f2', border: '#fecaca', text: '#991b1b' },
} as const;

/* ------------------------------------------------------------------ *
 * Building blocks
 *
 * Helpers keep the eight emails consistent, but what they produce is ordinary
 * formatted HTML — the stored template is what staff edit, so it has to read
 * well in a text area, not only in an inbox.
 * ------------------------------------------------------------------ */

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;letter-spacing:-0.3px;color:${INK};">
  ${text}
</h1>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${SOFT};">
  ${html}
</p>`;
}

function note(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">
  ${html}
</p>`;
}

function strong(html: string): string {
  return `<strong style="font-weight:600;color:${INK};">${html}</strong>`;
}

/** A table button: the one pattern that renders as a button in Outlook too. */
function button(label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;">
  <tr>
    <td align="center" bgcolor="${BRAND}" style="border-radius:8px;background-color:${BRAND};">
      <a href="{{actionUrl}}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${label}</a>
    </td>
  </tr>
</table>`;
}

/** Some clients block buttons, and some people read on a device that mangles them. */
const LINK_FALLBACK = `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">
  Button not working? Copy this link into your browser:<br>
  <a href="{{actionUrl}}" target="_blank" style="color:${BRAND_700};text-decoration:underline;word-break:break-all;">{{actionUrl}}</a>
</p>`;

const DIVIDER = `<hr style="border:0;border-top:1px solid ${LINE};margin:24px 0;">`;

function details(rows: readonly (readonly [label: string, value: string])[]): string {
  const body = rows
    .map(([label, value], index) => {
      const border = index < rows.length - 1 ? `border-bottom:1px solid ${LINE};` : '';
      return `  <tr>
    <td style="padding:12px 16px;${border}font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">${label}</td>
    <td align="right" style="padding:12px 16px;${border}font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${INK};">${value}</td>
  </tr>`;
    })
    .join('\n');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px 0;background-color:${SUNKEN};border:1px solid ${LINE};border-radius:10px;border-collapse:separate;">
${body}
</table>`;
}

function callout(tone: keyof typeof TONES, html: string): string {
  const colours = TONES[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px 0;">
  <tr>
    <td style="padding:14px 16px;background-color:${colours.background};border:1px solid ${colours.border};border-radius:10px;font-family:${FONT};font-size:14px;line-height:22px;color:${colours.text};">
      ${html}
    </td>
  </tr>
</table>`;
}

function steps(items: readonly (readonly [title: string, detail: string])[]): string {
  const rows = items
    .map(
      ([title, detail], index) => `  <tr>
    <td width="40" valign="top" style="padding:0 0 16px 0;">
      <div style="width:28px;height:28px;border-radius:14px;background-color:${BRAND_50};font-family:${FONT};font-size:13px;line-height:28px;font-weight:700;text-align:center;color:${BRAND_700};">${index + 1}</div>
    </td>
    <td valign="top" style="padding:0 0 16px 0;font-family:${FONT};">
      <p style="margin:0;font-size:15px;line-height:22px;font-weight:600;color:${INK};">${title}</p>
      <p style="margin:2px 0 0 0;font-size:14px;line-height:21px;color:${SOFT};">${detail}</p>
    </td>
  </tr>`,
    )
    .join('\n');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;">
${rows}
</table>`;
}

function body(...blocks: readonly string[]): string {
  return `${blocks.join('\n\n')}\n`;
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

const LAYOUT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>{{subject}}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; }
      .email-card { padding: 28px 22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
  {{#if preheader}}<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${CANVAS};">{{preheader}}</div>{{/if}}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CANVAS};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

          <!-- Brand mark, matching the sidebar: initial on brand green, then the name -->
          <tr>
            <td style="padding:0 4px 20px 4px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="36" height="36" align="center" valign="middle" bgcolor="${BRAND}" style="width:36px;height:36px;border-radius:10px;background-color:${BRAND};font-family:${FONT};font-size:17px;line-height:36px;font-weight:700;color:#ffffff;">{{appInitial}}</td>
                  <td style="padding-left:10px;font-family:${FONT};font-size:17px;font-weight:600;letter-spacing:-0.2px;color:${INK};">{{appName}}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td class="email-card" style="padding:36px 40px;background-color:#ffffff;border:1px solid ${LINE};border-radius:12px;">
{{{content}}}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 16px 0 16px;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
              Need help? Write to <a href="mailto:{{supportEmail}}" style="color:${BRAND_700};text-decoration:underline;">{{supportEmail}}</a>.<br>
              &copy; {{year}} {{appName}}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const LAYOUT_TEXT = `{{appName}}

{{{content}}}

---
Need help? Write to {{supportEmail}}.
(c) {{year}} {{appName}}
`;

/* ------------------------------------------------------------------ *
 * The templates
 * ------------------------------------------------------------------ */

export const EMAIL_TEMPLATE_DEFAULTS: readonly EmailTemplateDefault[] = [
  {
    key: EMAIL_LAYOUT_KEY,
    name: 'Base layout',
    description: 'The branded wrapper every email is rendered inside: header, card and footer.',
    category: 'layout',
    subject: '{{subject}}',
    htmlBody: LAYOUT_HTML,
    textBody: LAYOUT_TEXT,
    variables: [],
  },

  /* ------------------------------ account ------------------------------ */

  {
    key: 'auth.welcome',
    name: 'Welcome',
    description: 'Sent once a new workspace owner has finished signing up.',
    category: 'account',
    subject: 'Welcome to {{appName}}, {{name}}',
    htmlBody: body(
      heading('Welcome aboard, {{name}}'),
      paragraph(
        `Your workspace ${strong('{{workspaceName}}')} is ready. Three steps take you from here to your first campaign:`,
      ),
      steps([
        ['Connect WhatsApp', 'Link your WhatsApp Business number so messages go out under your name.'],
        ['Import your contacts', 'Upload a spreadsheet. Numbers are checked before anything is saved.'],
        ['Send your first campaign', 'Pick an approved template, choose an audience, then send now or schedule it.'],
      ]),
      button('Open your dashboard'),
      LINK_FALLBACK,
    ),
    textBody: `Welcome aboard, {{name}}

Your workspace "{{workspaceName}}" is ready. Three steps take you to your first campaign:

1. Connect WhatsApp: link your WhatsApp Business number so messages go out under your name.
2. Import your contacts: upload a spreadsheet. Numbers are checked before anything is saved.
3. Send your first campaign: pick an approved template, choose an audience, then send now or schedule it.

Open your dashboard:
{{actionUrl}}
`,
    variables: [
      { name: 'name', description: 'Recipient\'s name.', sample: 'Ayesha Khan' },
      { name: 'workspaceName', description: 'The new workspace.', sample: 'Northwind Retail' },
      { name: 'actionUrl', description: 'Link to the dashboard.', sample: 'https://app.nextreach.io/dashboard' },
    ],
  },

  {
    key: 'auth.invitation',
    name: 'Invitation',
    description: 'Sent when someone is invited to a workspace. Leads to setting a password.',
    category: 'account',
    subject:
      "{{#if inviterName}}{{inviterName}} invited you to join {{workspaceName}} on {{appName}}{{else}}You're invited to join {{workspaceName}} on {{appName}}{{/if}}",
    htmlBody: body(
      heading('Join {{workspaceName}}'),
      paragraph('Hi {{name}},'),
      paragraph(
        `{{#if inviterName}}${strong('{{inviterName}}')} has invited you{{else}}You've been invited{{/if}} to work in ${strong('{{workspaceName}}')} on {{appName}}. Set your password to get started.`,
      ),
      button('Accept invitation'),
      note('This link works once and expires in {{expiresInHours}} hours.'),
      LINK_FALLBACK,
      DIVIDER,
      note(
        "{{#if inviterEmail}}This invitation was sent by {{inviterName}} ({{inviterEmail}}) through {{appName}}. Replies go to them. {{/if}}Weren't expecting this? You can safely ignore this email. The link expires on its own.",
      ),
    ),
    textBody: `Hi {{name}},

{{#if inviterName}}{{inviterName}} has invited you{{else}}You've been invited{{/if}} to work in "{{workspaceName}}" on {{appName}}. Set your password to get started:

{{actionUrl}}

This link works once and expires in {{expiresInHours}} hours.

{{#if inviterEmail}}This invitation was sent by {{inviterName}} ({{inviterEmail}}) through {{appName}}. Replies go to them.
{{/if}}Weren't expecting this? You can safely ignore this email. The link expires on its own.
`,
    variables: [
      { name: 'name', description: 'Recipient\'s name.', sample: 'Ayesha Khan' },
      {
        name: 'inviterName',
        description: 'Who sent the invitation. Optional: blank when a platform administrator created the account.',
        sample: 'Amara Chen',
      },
      {
        name: 'inviterEmail',
        description:
          'Address of whoever sent it, shown so the recipient can check the invitation is genuine. Optional, blank with inviterName.',
        sample: 'amara.chen@northwind.example',
      },
      { name: 'workspaceName', description: 'Workspace they are joining.', sample: 'Northwind Retail' },
      {
        name: 'actionUrl',
        description: 'Link to set a password.',
        sample: 'https://app.nextreach.io/auth/accept-invitation?token=sample',
      },
      { name: 'expiresInHours', description: 'Hours until the link expires.', sample: '72' },
    ],
  },

  {
    key: 'auth.password_reset',
    name: 'Password reset',
    description: 'Sent when someone asks to reset a forgotten password.',
    category: 'account',
    subject: 'Reset your {{appName}} password',
    htmlBody: body(
      heading('Reset your password'),
      paragraph('Hi {{name}},'),
      paragraph('We received a request to reset the password on your account. Choose a new one with the button below.'),
      button('Choose a new password'),
      note('For your security, this link works once and expires in {{expiresInHours}} hour(s).'),
      callout(
        'warning',
        "<strong>Didn't ask for this?</strong> Ignore this email and your password stays the same. If these keep arriving, write to {{supportEmail}}.",
      ),
      LINK_FALLBACK,
    ),
    textBody: `Hi {{name}},

We received a request to reset the password on your account. Choose a new one here:

{{actionUrl}}

For your security, this link works once and expires in {{expiresInHours}} hour(s).

Didn't ask for this? Ignore this email and your password stays the same. If these keep arriving, write to {{supportEmail}}.
`,
    variables: [
      { name: 'name', description: 'Recipient\'s name.', sample: 'Ayesha Khan' },
      {
        name: 'actionUrl',
        description: 'Link to choose a new password.',
        sample: 'https://app.nextreach.io/auth/reset-password?token=sample',
      },
      { name: 'expiresInHours', description: 'Hours until the link expires.', sample: '1' },
    ],
  },

  {
    key: 'auth.email_changed',
    name: 'Email address changed',
    description: 'A security notice sent when the email address on an account changes.',
    category: 'account',
    subject: 'Your {{appName}} email address was changed',
    htmlBody: body(
      heading('Your email address was changed'),
      paragraph('Hi {{name}},'),
      paragraph(
        `The email address on your {{appName}} account is now ${strong('{{newEmail}}')}. We're letting you know in case this wasn't you.`,
      ),
      callout(
        'danger',
        `<strong>Wasn't you?</strong> Write to <a href="mailto:{{supportEmail}}" style="color:${TONES.danger.text};text-decoration:underline;">{{supportEmail}}</a> straight away. Whoever controls the new address can reset your password.`,
      ),
      note("If you made this change, there's nothing else to do."),
    ),
    textBody: `Hi {{name}},

The email address on your {{appName}} account is now {{newEmail}}. We're letting you know in case this wasn't you.

Wasn't you? Write to {{supportEmail}} straight away. Whoever controls the new address can reset your password.

If you made this change, there's nothing else to do.
`,
    variables: [
      { name: 'name', description: 'Recipient\'s name.', sample: 'Ayesha Khan' },
      { name: 'newEmail', description: 'The address the account now uses.', sample: 'ayesha.khan@northwind.example' },
    ],
  },

  /* ------------------------------ billing ------------------------------ */

  {
    key: 'billing.subscription_expiring',
    name: 'Plan expiring',
    description: 'Reminder sent to workspace administrators before their plan ends.',
    category: 'billing',
    subject: 'Your {{planName}} plan expires {{expiresIn}}',
    htmlBody: body(
      heading('Your plan expires {{expiresIn}}'),
      paragraph('Hi {{name}},'),
      paragraph(
        `Your ${strong('{{planName}}')} plan ends on ${strong('{{expiresOn}}')}. Renew before then to keep everything running.`,
      ),
      details([
        ['Plan', '{{planName}}'],
        ['Ends on', '{{expiresOn}}'],
      ]),
      callout('warning', "When the plan ends, scheduled campaigns stop sending until it's renewed."),
      button('Renew your plan'),
      LINK_FALLBACK,
    ),
    textBody: `Hi {{name}},

Your {{planName}} plan ends on {{expiresOn}}. Renew before then to keep everything running.

When the plan ends, scheduled campaigns stop sending until it's renewed.

Renew your plan:
{{actionUrl}}
`,
    variables: [
      { name: 'name', description: 'Recipient\'s name.', sample: 'Ayesha Khan' },
      { name: 'planName', description: 'The plan that is ending.', sample: 'Growth' },
      { name: 'expiresIn', description: 'Relative wording, e.g. "in 7 days" or "tomorrow".', sample: 'in 7 days' },
      { name: 'expiresOn', description: 'The date it ends, already formatted.', sample: '21 September 2026' },
      { name: 'actionUrl', description: 'Link to renew.', sample: 'https://app.nextreach.io/subscription' },
    ],
  },

  /* ------------------------------ payments ------------------------------ */

  {
    key: 'payments.submitted',
    name: 'Payment submitted',
    description: 'Sent to platform administrators when a workspace submits proof of payment.',
    category: 'payments',
    subject: 'Payment to review: {{organisation}}',
    htmlBody: body(
      heading('A payment is waiting for review'),
      paragraph('Hi {{name}},'),
      paragraph(
        `${strong('{{organisation}}')} submitted proof of payment. Their plan changes only once it's approved.`,
      ),
      details([
        ['Workspace', '{{organisation}}'],
        ['Plan', '{{planName}}'],
        ['Amount', '{{amount}}'],
      ]),
      button('Review payment'),
      LINK_FALLBACK,
    ),
    textBody: `Hi {{name}},

{{organisation}} submitted proof of payment. Their plan changes only once it's approved.

Workspace: {{organisation}}
Plan: {{planName}}
Amount: {{amount}}

Review it:
{{actionUrl}}
`,
    variables: [
      { name: 'name', description: 'Reviewer\'s name.', sample: 'Priya Raman' },
      { name: 'organisation', description: 'Workspace that submitted the payment.', sample: 'Northwind Retail' },
      { name: 'planName', description: 'Plan being paid for.', sample: 'Growth' },
      { name: 'amount', description: 'Amount and currency, already formatted.', sample: 'PKR 14,999' },
      { name: 'actionUrl', description: 'Link to the review screen.', sample: 'https://app.nextreach.io/superadmin/payments' },
    ],
  },

  {
    key: 'payments.approved',
    name: 'Payment approved',
    description: 'Sent to a workspace when its payment is confirmed and the plan is active.',
    category: 'payments',
    subject: 'Payment confirmed: {{planName}} is active',
    htmlBody: body(
      heading('Your payment is confirmed'),
      paragraph('Hi {{name}},'),
      callout('success', '<strong>{{planName}}</strong> is now active on your workspace.'),
      details([
        ['Amount', '{{amount}}'],
        ['Plan', '{{planName}}'],
        ['Active until', '{{activeUntil}}'],
      ]),
      button('View subscription'),
      LINK_FALLBACK,
    ),
    textBody: `Hi {{name}},

Your payment is confirmed. {{planName}} is now active on your workspace.

Amount: {{amount}}
Plan: {{planName}}
Active until: {{activeUntil}}

View your subscription:
{{actionUrl}}
`,
    variables: [
      { name: 'name', description: 'Recipient\'s name.', sample: 'Ayesha Khan' },
      { name: 'amount', description: 'Amount and currency, already formatted.', sample: 'PKR 14,999' },
      { name: 'planName', description: 'Plan now active.', sample: 'Growth' },
      { name: 'activeUntil', description: 'When the plan runs until, already formatted.', sample: '14 October 2026' },
      { name: 'actionUrl', description: 'Link to the subscription page.', sample: 'https://app.nextreach.io/subscription' },
    ],
  },

  {
    key: 'payments.rejected',
    name: 'Payment rejected',
    description: 'Sent to a workspace when its payment could not be confirmed.',
    category: 'payments',
    subject: "We couldn't confirm your payment",
    htmlBody: body(
      heading("We couldn't confirm your payment"),
      paragraph('Hi {{name}},'),
      paragraph(
        `Your payment for the ${strong('{{planName}}')} plan wasn't approved, so your plan hasn't changed.`,
      ),
      callout('danger', '<strong>Reason given</strong><br>{{reason}}'),
      paragraph('You can submit the payment again with the details corrected.'),
      button('Submit again'),
      LINK_FALLBACK,
    ),
    textBody: `Hi {{name}},

Your payment for the {{planName}} plan wasn't approved, so your plan hasn't changed.

Reason given:
{{reason}}

You can submit the payment again with the details corrected:
{{actionUrl}}
`,
    variables: [
      { name: 'name', description: 'Recipient\'s name.', sample: 'Ayesha Khan' },
      { name: 'planName', description: 'Plan the payment was for.', sample: 'Growth' },
      {
        name: 'reason',
        description: 'Why it was rejected, as written by the reviewer.',
        sample: 'The transfer reference did not match any payment we received. Please upload the bank receipt.',
      },
      { name: 'actionUrl', description: 'Link to try again.', sample: 'https://app.nextreach.io/pricing' },
    ],
  },
];
