import type { NavSection } from '@core/models/navigation.model';

/**
 * Single definition driving both the sidebar and the route guards.
 *
 * `permissions` hides an item the user cannot use; `module` hides one their
 * plan does not include. An item needs to clear both to appear.
 */
export const NAVIGATION: readonly NavSection[] = [
  {
    title: null,
    items: [
      // Gated on the real permission rather than shown unconditionally. It is a
      // floor the API grants every member, so everyone still sees it — but the
      // sidebar now states a fact instead of making an exception.
      { label: 'Dashboard', route: '/dashboard', icon: 'home', permissions: ['dashboard.view'] },
    ],
  },
  {
    title: 'Audience',
    items: [
      {
        label: 'Contacts',
        route: '/contacts',
        icon: 'users',
        permissions: ['contacts.view'],
        module: 'crm',
      },
      {
        label: 'Import',
        route: '/contacts/import',
        icon: 'upload',
        permissions: ['contacts.import'],
        module: 'crm',
      },
      {
        label: 'Groups',
        route: '/groups',
        icon: 'userGroup',
        permissions: ['groups.manage'],
        module: 'crm',
      },
      {
        label: 'Tags',
        route: '/tags',
        icon: 'tag',
        permissions: ['tags.manage'],
        module: 'crm',
      },
    ],
  },
  {
    title: 'Messaging',
    items: [
      {
        label: 'WhatsApp',
        route: '/whatsapp',
        icon: 'chat',
        permissions: ['whatsapp.templates.view', 'whatsapp.connect'],
        module: 'whatsapp',
      },
      {
        label: 'Templates',
        route: '/templates',
        icon: 'document',
        permissions: ['whatsapp.templates.view'],
        module: 'whatsapp',
      },
      {
        label: 'Campaigns',
        route: '/campaigns',
        icon: 'megaphone',
        permissions: ['whatsapp.campaigns.reports', 'whatsapp.campaigns.create'],
        module: 'whatsapp',
      },
      {
        label: 'Inbox',
        route: '/inbox',
        icon: 'inbox',
        permissions: ['whatsapp.inbox.view'],
        module: 'whatsapp',
      },
    ],
  },
  {
    title: 'Insights',
    items: [
      {
        label: 'Reports',
        route: '/reports',
        icon: 'chartBar',
        permissions: ['reports.view'],
        module: 'reporting',
      },
    ],
  },
  {
    title: 'Workspace',
    items: [
      {
        label: 'Employees',
        route: '/employees',
        icon: 'userGroup',
        permissions: ['settings.employees'],
        module: 'employees',
      },
      {
        label: 'Subscription',
        route: '/subscription',
        icon: 'sparkles',
        permissions: ['settings.subscription'],
      },
      {
        label: 'Billing',
        route: '/billing',
        icon: 'creditCard',
        permissions: ['settings.billing'],
      },
    ],
  },
  // Platform administration is not part of this portal — see
  // `superadmin-navigation.config.ts`.
  {
    title: null,
    items: [
      // Back behind a permission — but only because personal settings are now
      // reachable from the account menu under the avatar, which is where they
      // conventionally live. That was the missing piece before: gating this
      // entry used to leave an employee with no route to their own profile at
      // all. The sidebar is for workspace features you can use; your own
      // account is not one of them.
      {
        label: 'Settings',
        route: '/settings',
        icon: 'cog',
        permissions: ['settings.company'],
      },
    ],
  },
];
