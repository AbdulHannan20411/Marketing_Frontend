/**
 * Transactional email templates.
 *
 * **Platform-wide, not per workspace.** Platform staff edit them, and every
 * tenant's users receive the same wording. They live in the database so copy can
 * change without a deployment, and are seeded from `EMAIL_TEMPLATE_DEFAULTS` so a
 * fresh database is never without them.
 *
 * Every email is two parts: the shared layout (brand header, card, footer) and a
 * body rendered inside it. Branding therefore changes in one place.
 */

export type EmailTemplateCategory = 'layout' | 'account' | 'billing' | 'payments';

export const EMAIL_TEMPLATE_CATEGORY_LABEL: Readonly<Record<EmailTemplateCategory, string>> = {
  layout: 'Layout',
  account: 'Account',
  billing: 'Billing',
  payments: 'Payments',
};

export const EMAIL_TEMPLATE_CATEGORY_ORDER: readonly EmailTemplateCategory[] = [
  'layout',
  'account',
  'billing',
  'payments',
];

/** The wrapper every other template is rendered inside. */
export const EMAIL_LAYOUT_KEY = 'layout.base';

/** Most inboxes cut a subject off well before this; past it is certainly a mistake. */
export const EMAIL_SUBJECT_MAX_LENGTH = 200;

export interface EmailTemplateVariable {
  readonly name: string;
  readonly description: string;
  /** Used by the live preview and by test sends. Never real customer data. */
  readonly sample: string;
}

export interface EmailTemplateSummary {
  /** Stable identifier the sending code refers to, e.g. `auth.invitation`. */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: EmailTemplateCategory;
  readonly subject: string;
  /** Differs from the shipped default — what "Reset to default" undoes. */
  readonly isCustomised: boolean;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface EmailTemplate extends EmailTemplateSummary {
  readonly htmlBody: string;
  readonly textBody: string;
  /** Variables specific to this email. System variables are added separately. */
  readonly variables: readonly EmailTemplateVariable[];
}

/** The three editable parts. Everything else about a template is fixed. */
export interface EmailTemplateDraft {
  readonly subject: string;
  readonly htmlBody: string;
  readonly textBody: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface TestEmailResult {
  /** Where the test went — always the signed-in staff member, never a customer. */
  readonly sentTo: string;
}

/** Supplied to every template and to the layout by the sending code. */
export const SYSTEM_EMAIL_VARIABLES: readonly EmailTemplateVariable[] = [
  { name: 'appName', description: 'Product name.', sample: 'NextReach' },
  {
    name: 'appInitial',
    description: 'First letter of the product name, used in the logo mark.',
    sample: 'N',
  },
  { name: 'supportEmail', description: 'Where customers reach support.', sample: 'support@nextreach.io' },
  { name: 'clientBaseUrl', description: 'Base address of the web app.', sample: 'https://app.nextreach.io' },
  { name: 'year', description: 'Current year, for the footer.', sample: '2026' },
];

/** Available to the layout only. */
export const LAYOUT_EMAIL_VARIABLES: readonly EmailTemplateVariable[] = [
  {
    name: 'subject',
    description: 'The rendered subject, used as the document title.',
    sample: 'Welcome to NextReach',
  },
  {
    name: 'preheader',
    description: 'Inbox preview text shown beside the subject. Optional.',
    sample: 'Your workspace is ready.',
  },
];

/** Every variable a template may reference: its own, the system's, and — for the layout — the layout's. */
export function variablesFor(
  template: Pick<EmailTemplate, 'key' | 'variables'>,
): readonly EmailTemplateVariable[] {
  return [
    ...template.variables,
    ...SYSTEM_EMAIL_VARIABLES,
    ...(template.key === EMAIL_LAYOUT_KEY ? LAYOUT_EMAIL_VARIABLES : []),
  ];
}
