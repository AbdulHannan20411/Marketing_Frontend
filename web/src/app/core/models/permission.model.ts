/**
 * Fine-grained permission catalogue.
 *
 * Roles are a convenience for assigning these in bulk — authorisation itself is
 * always evaluated against the permission set, never against the role name.
 * An Employee starts with nothing and is granted permissions explicitly.
 */
export const PERMISSIONS = [
  // Dashboard
  'dashboard.view',
  'dashboard.statistics',
  'dashboard.export',

  // Contacts
  'contacts.view',
  'contacts.create',
  'contacts.edit',
  'contacts.delete',
  'contacts.import',
  'contacts.export',

  // Audience organisation
  'groups.manage',
  'tags.manage',

  // WhatsApp marketing
  'whatsapp.connect',
  'whatsapp.disconnect',
  'whatsapp.templates.sync',
  'whatsapp.templates.view',
  'whatsapp.campaigns.create',
  'whatsapp.campaigns.edit',
  'whatsapp.campaigns.delete',
  'whatsapp.campaigns.schedule',
  'whatsapp.campaigns.send',
  'whatsapp.campaigns.pause',
  'whatsapp.campaigns.cancel',
  'whatsapp.campaigns.reports',
  'whatsapp.inbox.view',
  'whatsapp.inbox.reply',

  // Email marketing
  'email.connect',
  'email.templates.manage',
  'email.campaigns.create',
  'email.campaigns.send',
  'email.analytics.view',

  // Social media automation
  'social.accounts.connect',
  'social.posts.create',
  'social.posts.schedule',
  'social.posts.publish',
  'social.posts.delete',
  'social.analytics.view',

  // Reports
  'reports.view',
  'reports.export',
  'reports.download.csv',
  'reports.download.excel',
  'reports.download.pdf',

  // Settings
  'settings.company',
  'settings.employees',
  'settings.billing',
  'settings.subscription',
  'settings.integrations',
  'settings.apikeys',

  // Platform administration (SuperAdmin only)
  'platform.tenants',
  'platform.audit',
  'platform.monitoring',
  'platform.plans',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionCategoryKey =
  | 'dashboard'
  | 'contacts'
  | 'whatsapp'
  | 'email'
  | 'social'
  | 'reports'
  | 'settings'
  | 'platform';

export interface PermissionDefinition {
  readonly key: Permission;
  readonly label: string;
  readonly description: string;
}

export interface PermissionCategory {
  readonly key: PermissionCategoryKey;
  readonly label: string;
  readonly description: string;
  /** Module this category belongs to; the matrix dims it when unsubscribed. */
  readonly module: FeatureModule | null;
  readonly permissions: readonly PermissionDefinition[];
}

/** Subscription-gated modules. A plan turns each of these on or off. */
export const FEATURE_MODULES = [
  'whatsapp',
  'email',
  'social',
  'crm',
  'reporting',
  'ai',
  'api',
  'employees',
] as const;

export type FeatureModule = (typeof FEATURE_MODULES)[number];

export const FEATURE_MODULE_LABEL: Readonly<Record<FeatureModule, string>> = {
  whatsapp: 'WhatsApp Marketing',
  email: 'Email Marketing',
  social: 'Social Media Automation',
  crm: 'CRM',
  reporting: 'Reporting',
  ai: 'AI Features',
  api: 'API Access',
  employees: 'Employee Management',
};

export const PERMISSION_CATALOGUE: readonly PermissionCategory[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Executive overview and headline metrics.',
    module: null,
    permissions: [
      { key: 'dashboard.view', label: 'View dashboard', description: 'Open the dashboard.' },
      {
        key: 'dashboard.statistics',
        label: 'View statistics',
        description: 'See KPI cards and charts.',
      },
      { key: 'dashboard.export', label: 'Export dashboard', description: 'Download a snapshot.' },
    ],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'The audience database.',
    module: 'crm',
    permissions: [
      { key: 'contacts.view', label: 'View', description: 'Browse and search contacts.' },
      { key: 'contacts.create', label: 'Create', description: 'Add contacts manually.' },
      { key: 'contacts.edit', label: 'Edit', description: 'Change contact details and tags.' },
      { key: 'contacts.delete', label: 'Delete', description: 'Remove contacts permanently.' },
      { key: 'contacts.import', label: 'Import', description: 'Bulk import from CSV.' },
      { key: 'contacts.export', label: 'Export', description: 'Download the contact list.' },
      { key: 'groups.manage', label: 'Manage groups', description: 'Create and edit segments.' },
      { key: 'tags.manage', label: 'Manage tags', description: 'Create and edit labels.' },
    ],
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp Marketing',
    description: 'Connection, templates and campaigns.',
    module: 'whatsapp',
    permissions: [
      { key: 'whatsapp.connect', label: 'Connect WhatsApp', description: 'Link a business number.' },
      {
        key: 'whatsapp.disconnect',
        label: 'Disconnect WhatsApp',
        description: 'Revoke the connection.',
      },
      {
        key: 'whatsapp.templates.view',
        label: 'View templates',
        description: 'Browse message templates.',
      },
      {
        key: 'whatsapp.templates.sync',
        label: 'Sync templates',
        description: 'Pull the latest from Meta.',
      },
      {
        key: 'whatsapp.inbox.view',
        label: 'View inbox',
        description: 'Read customer conversations.',
      },
      {
        key: 'whatsapp.inbox.reply',
        label: 'Reply in inbox',
        description: 'Send messages inside the 24-hour window.',
      },
      {
        key: 'whatsapp.campaigns.create',
        label: 'Create campaign',
        description: 'Draft a new campaign.',
      },
      { key: 'whatsapp.campaigns.edit', label: 'Edit campaign', description: 'Change a draft.' },
      {
        key: 'whatsapp.campaigns.delete',
        label: 'Delete campaign',
        description: 'Remove a campaign.',
      },
      {
        key: 'whatsapp.campaigns.schedule',
        label: 'Schedule campaign',
        description: 'Set a send time.',
      },
      {
        key: 'whatsapp.campaigns.send',
        label: 'Send campaign',
        description: 'Dispatch to the audience.',
      },
      {
        key: 'whatsapp.campaigns.pause',
        label: 'Pause campaign',
        description: 'Halt an in-flight send.',
      },
      {
        key: 'whatsapp.campaigns.cancel',
        label: 'Cancel campaign',
        description: 'Abandon a scheduled send.',
      },
      {
        key: 'whatsapp.campaigns.reports',
        label: 'View campaign reports',
        description: 'See delivery analytics.',
      },
    ],
  },
  {
    key: 'email',
    label: 'Email Marketing',
    description: 'Providers, templates and email campaigns.',
    module: 'email',
    permissions: [
      { key: 'email.connect', label: 'Connect provider', description: 'Link an email provider.' },
      {
        key: 'email.templates.manage',
        label: 'Manage templates',
        description: 'Create and edit email templates.',
      },
      {
        key: 'email.campaigns.create',
        label: 'Create campaign',
        description: 'Draft an email campaign.',
      },
      { key: 'email.campaigns.send', label: 'Send campaign', description: 'Dispatch an email send.' },
      { key: 'email.analytics.view', label: 'View analytics', description: 'Opens, clicks, bounces.' },
    ],
  },
  {
    key: 'social',
    label: 'Social Media Automation',
    description: 'Facebook, Instagram, LinkedIn and X.',
    module: 'social',
    permissions: [
      {
        key: 'social.accounts.connect',
        label: 'Connect account',
        description: 'Link a social profile.',
      },
      { key: 'social.posts.create', label: 'Create posts', description: 'Draft social posts.' },
      { key: 'social.posts.schedule', label: 'Schedule posts', description: 'Queue for later.' },
      { key: 'social.posts.publish', label: 'Publish posts', description: 'Post immediately.' },
      { key: 'social.posts.delete', label: 'Delete posts', description: 'Remove published posts.' },
      {
        key: 'social.analytics.view',
        label: 'View analytics',
        description: 'Reach and engagement.',
      },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'Analytics and exports.',
    module: 'reporting',
    permissions: [
      { key: 'reports.view', label: 'View', description: 'Open reports.' },
      { key: 'reports.export', label: 'Export', description: 'Queue a data export.' },
      { key: 'reports.download.csv', label: 'Download CSV', description: 'Export as CSV.' },
      { key: 'reports.download.excel', label: 'Download Excel', description: 'Export as XLSX.' },
      { key: 'reports.download.pdf', label: 'Download PDF', description: 'Export as PDF.' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    description: 'Workspace configuration and billing.',
    module: null,
    permissions: [
      { key: 'settings.company', label: 'Company profile', description: 'Business details.' },
      { key: 'settings.employees', label: 'Employees', description: 'Invite and manage the team.' },
      { key: 'settings.billing', label: 'Billing', description: 'Invoices and payment methods.' },
      { key: 'settings.subscription', label: 'Subscription', description: 'Plan and usage.' },
      { key: 'settings.integrations', label: 'Integrations', description: 'Third-party connections.' },
      { key: 'settings.apikeys', label: 'API keys', description: 'Issue and revoke credentials.' },
    ],
  },
  {
    key: 'platform',
    label: 'Platform Administration',
    description: 'Cross-tenant operations. SuperAdmin only.',
    module: null,
    permissions: [
      { key: 'platform.tenants', label: 'Tenants', description: 'Manage every workspace.' },
      { key: 'platform.audit', label: 'Audit logs', description: 'Read the platform audit trail.' },
      { key: 'platform.monitoring', label: 'Monitoring', description: 'Service health and quotas.' },
      {
        key: 'platform.plans',
        label: 'Subscription plans',
        description: 'Create and price plans.',
      },
    ],
  },
];

/** Flat lookup used when rendering a permission by key. */
export const PERMISSION_BY_KEY: ReadonlyMap<Permission, PermissionDefinition> = new Map(
  PERMISSION_CATALOGUE.flatMap((category) =>
    category.permissions.map((permission) => [permission.key, permission] as const),
  ),
);
