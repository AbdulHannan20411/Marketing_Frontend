import type { NavSection } from '@core/models/navigation.model';

export const NAVIGATION: readonly NavSection[] = [
  {
    title: null,
    items: [{ label: 'Dashboard', route: '/dashboard', icon: 'home', permissions: [] }],
  },
  {
    title: 'Audience',
    items: [
      { label: 'Contacts', route: '/contacts', icon: 'users', permissions: ['contacts.read'] },
      { label: 'Groups', route: '/groups', icon: 'userGroup', permissions: ['groups.manage'] },
      { label: 'Tags', route: '/tags', icon: 'tag', permissions: ['tags.manage'] },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { label: 'WhatsApp', route: '/whatsapp', icon: 'chat', permissions: ['whatsapp.read'] },
      {
        label: 'Templates',
        route: '/templates',
        icon: 'document',
        permissions: ['templates.read'],
      },
      {
        label: 'Campaigns',
        route: '/campaigns',
        icon: 'megaphone',
        permissions: ['campaigns.read'],
      },
    ],
  },
  {
    title: 'Insights',
    items: [{ label: 'Reports', route: '/reports', icon: 'chartBar', permissions: ['reports.read'] }],
  },
  {
    title: 'Platform',
    items: [
      {
        label: 'Tenants',
        route: '/admin/tenants',
        icon: 'building',
        permissions: ['platform.tenants'],
        roles: ['PlatformAdmin'],
      },
      {
        label: 'Audit Logs',
        route: '/admin/audit',
        icon: 'clipboard',
        permissions: ['platform.audit'],
        roles: ['PlatformAdmin'],
      },
      {
        label: 'Monitoring',
        route: '/admin/monitoring',
        icon: 'shield',
        permissions: ['platform.monitoring'],
        roles: ['PlatformAdmin'],
      },
    ],
  },
  {
    title: null,
    items: [
      { label: 'Settings', route: '/settings', icon: 'cog', permissions: ['settings.manage'] },
    ],
  },
];
