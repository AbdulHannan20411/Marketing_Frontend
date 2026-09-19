import type { NavSection } from '@core/models/navigation.model';

/**
 * Navigation for the Super Admin portal.
 *
 * Items marked `requiresScope` belong to a single Admin's workspace — contacts,
 * tags, WhatsApp and so on have no platform-wide meaning. `LayoutService` hides
 * them until the Super Admin chooses "View as" on an Admin, then shows them in
 * the same sections and order that Admin's own sidebar uses. `scopeGuard` still
 * diverts a direct URL to the Admin picker when no Admin is selected.
 *
 * No `module` gating appears here — plan limits never apply to a Super Admin.
 */
export const SUPERADMIN_NAVIGATION: readonly NavSection[] = [
  {
    title: null,
    items: [
      { label: 'Dashboard', route: '/superadmin/dashboard', icon: 'home', permissions: [] },
      { label: 'Admins', route: '/superadmin/admins', icon: 'building', permissions: [] },
    ],
  },
  {
    title: 'Audience',
    items: [
      { label: 'Contacts', route: '/superadmin/contacts', icon: 'users', permissions: [], requiresScope: true },
      {
        label: 'Import',
        route: '/superadmin/contacts/import',
        icon: 'upload',
        permissions: [],
        requiresScope: true,
      },
      { label: 'Groups', route: '/superadmin/groups', icon: 'userGroup', permissions: [], requiresScope: true },
      { label: 'Tags', route: '/superadmin/tags', icon: 'tag', permissions: [], requiresScope: true },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { label: 'WhatsApp', route: '/superadmin/whatsapp', icon: 'chat', permissions: [], requiresScope: true },
      {
        label: 'Templates',
        route: '/superadmin/templates',
        icon: 'document',
        permissions: [],
        requiresScope: true,
      },
      {
        label: 'Campaigns',
        route: '/superadmin/campaigns',
        icon: 'megaphone',
        permissions: [],
        requiresScope: true,
      },
    ],
  },
  {
    title: 'AI',
    items: [
      {
        label: 'AI Assistant',
        route: '/superadmin/ai-assistant',
        icon: 'sparkles',
        permissions: [],
        requiresScope: true,
      },
      {
        label: 'Auto-reply',
        route: '/superadmin/ai-assistant/auto-reply',
        icon: 'chat',
        permissions: [],
        requiresScope: true,
      },
    ],
  },
  {
    title: 'Insights',
    items: [
      // Not scoped: global reports without an Admin, that Admin's reports with one.
      { label: 'Reports', route: '/superadmin/reports', icon: 'chartBar', permissions: [] },
    ],
  },
  {
    title: 'Workspace',
    items: [
      {
        label: 'Employees',
        route: '/superadmin/employees',
        icon: 'userGroup',
        permissions: [],
        requiresScope: true,
      },
    ],
  },
  {
    title: 'Platform',
    items: [
      { label: 'Plans', route: '/superadmin/plans', icon: 'rocket', permissions: [] },
      // Sits directly under Plans: it is where a plan is actually granted.
      { label: 'Payments', route: '/superadmin/payments', icon: 'creditCard', permissions: [] },
      { label: 'Email templates', route: '/superadmin/email-templates', icon: 'envelope', permissions: [] },
      { label: 'Tenants', route: '/superadmin/tenants', icon: 'building', permissions: [] },
      { label: 'Audit Logs', route: '/superadmin/audit', icon: 'clipboard', permissions: [] },
      { label: 'Security', route: '/superadmin/security', icon: 'lock', permissions: [] },
      { label: 'Monitoring', route: '/superadmin/monitoring', icon: 'shield', permissions: [] },
    ],
  },
  {
    title: null,
    items: [{ label: 'Settings', route: '/superadmin/settings', icon: 'cog', permissions: [] }],
  },
];
