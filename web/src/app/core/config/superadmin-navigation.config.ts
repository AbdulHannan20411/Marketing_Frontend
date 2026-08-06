import type { NavSection } from '@core/models/navigation.model';

/**
 * Navigation for the Super Admin portal.
 *
 * Items marked `requiresScope` operate inside a selected Admin's context; the
 * `scopeGuard` diverts them to the Admin picker until one is chosen. No
 * `module` gating appears here — plan limits never apply to a Super Admin.
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
    title: 'Admin workspace',
    items: [
      {
        label: 'Contacts',
        route: '/superadmin/contacts',
        icon: 'users',
        permissions: [],
        requiresScope: true,
      },
      {
        label: 'Groups',
        route: '/superadmin/groups',
        icon: 'userGroup',
        permissions: [],
        requiresScope: true,
      },
      {
        label: 'Tags',
        route: '/superadmin/tags',
        icon: 'tag',
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
      {
        label: 'Templates',
        route: '/superadmin/templates',
        icon: 'document',
        permissions: [],
        requiresScope: true,
      },
      {
        label: 'WhatsApp',
        route: '/superadmin/whatsapp',
        icon: 'chat',
        permissions: [],
        requiresScope: true,
      },
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
    title: 'Insights',
    items: [
      { label: 'Reports', route: '/superadmin/reports', icon: 'chartBar', permissions: [] },
    ],
  },
  {
    title: 'Platform',
    items: [
      { label: 'Plans', route: '/superadmin/plans', icon: 'rocket', permissions: [] },
      { label: 'Tenants', route: '/superadmin/tenants', icon: 'building', permissions: [] },
      { label: 'Audit Logs', route: '/superadmin/audit', icon: 'clipboard', permissions: [] },
      { label: 'Monitoring', route: '/superadmin/monitoring', icon: 'shield', permissions: [] },
    ],
  },
  {
    title: null,
    items: [
      { label: 'Settings', route: '/superadmin/settings', icon: 'cog', permissions: [] },
    ],
  },
];
