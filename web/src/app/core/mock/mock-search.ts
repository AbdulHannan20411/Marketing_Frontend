import type { SearchResult, SearchResultGroup, SearchResultKind } from '@core/models/search.model';
import { CAMPAIGNS, CONTACTS, TEMPLATES } from './mock-data';
import { EMPLOYEES } from './mock-billing-data';

const GROUP_LABEL: Readonly<Record<SearchResultKind, string>> = {
  contact: 'Contacts',
  campaign: 'Campaigns',
  template: 'Templates',
  employee: 'Employees',
  report: 'Reports',
  subscription: 'Subscription',
  setting: 'Settings',
};

/** Static destinations that are searchable but not backed by a record. */
const STATIC_RESULTS: readonly SearchResult[] = [
  {
    id: 'nav_reports',
    kind: 'report',
    title: 'Delivery report',
    subtitle: 'Delivery, read and click analytics',
    icon: 'chartBar',
    route: '/reports',
  },
  {
    id: 'nav_failures',
    kind: 'report',
    title: 'Failure log',
    subtitle: 'Undelivered messages and error codes',
    icon: 'warning',
    route: '/reports',
  },
  {
    id: 'nav_subscription',
    kind: 'subscription',
    title: 'Subscription & usage',
    subtitle: 'Plan, renewal date and consumption',
    icon: 'sparkles',
    route: '/subscription',
  },
  {
    id: 'nav_pricing',
    kind: 'subscription',
    title: 'Plans & pricing',
    subtitle: 'Compare plans and upgrade',
    icon: 'rocket',
    route: '/pricing',
  },
  {
    id: 'nav_billing',
    kind: 'subscription',
    title: 'Billing history',
    subtitle: 'Invoices, payments and renewals',
    icon: 'creditCard',
    route: '/billing',
  },
  {
    id: 'nav_employees',
    kind: 'setting',
    title: 'Employees & permissions',
    subtitle: 'Team members and permission sets',
    icon: 'users',
    route: '/employees',
  },
  {
    id: 'nav_settings',
    kind: 'setting',
    title: 'Workspace settings',
    subtitle: 'Company profile and integrations',
    icon: 'cog',
    route: '/settings',
  },
  {
    id: 'nav_notifications',
    kind: 'setting',
    title: 'Notification center',
    subtitle: 'All alerts and activity',
    icon: 'bell',
    route: '/notifications',
  },
];

const MAX_PER_GROUP = 4;

function matches(haystack: string, term: string): boolean {
  return haystack.toLowerCase().includes(term);
}

/**
 * Cross-entity search backing the command palette. Ranking is intentionally
 * simple — group order first, then source order — which is enough for a
 * palette that caps each group at a handful of hits.
 */
export function searchEverything(rawQuery: string): readonly SearchResultGroup[] {
  const term = rawQuery.trim().toLowerCase();
  if (term.length === 0) {
    return [];
  }

  const results: SearchResult[] = [];

  for (const contact of CONTACTS) {
    if (matches(contact.fullName, term) || matches(contact.phoneNumber, term) || matches(contact.email ?? '', term)) {
      results.push({
        id: contact.id,
        kind: 'contact',
        title: contact.fullName,
        subtitle: contact.email ?? contact.phoneNumber,
        icon: 'users',
        route: '/contacts',
      });
    }
  }

  for (const campaign of CAMPAIGNS) {
    if (matches(campaign.name, term) || matches(campaign.templateName, term)) {
      results.push({
        id: campaign.id,
        kind: 'campaign',
        title: campaign.name,
        subtitle: `${campaign.status} · ${campaign.audienceLabel}`,
        icon: 'megaphone',
        route: '/campaigns',
      });
    }
  }

  for (const template of TEMPLATES) {
    if (matches(template.name, term) || matches(template.bodyText, term)) {
      results.push({
        id: template.id,
        kind: 'template',
        title: template.name,
        subtitle: `${template.category} · ${template.status}`,
        icon: 'document',
        route: '/templates',
      });
    }
  }

  for (const employee of EMPLOYEES) {
    if (matches(employee.name, term) || matches(employee.email, term) || matches(employee.jobTitle, term)) {
      results.push({
        id: employee.id,
        kind: 'employee',
        title: employee.name,
        subtitle: `${employee.jobTitle} · ${employee.role}`,
        icon: 'userGroup',
        route: '/employees',
      });
    }
  }

  for (const item of STATIC_RESULTS) {
    if (matches(item.title, term) || matches(item.subtitle, term)) {
      results.push(item);
    }
  }

  const order: readonly SearchResultKind[] = [
    'contact',
    'campaign',
    'template',
    'employee',
    'report',
    'subscription',
    'setting',
  ];

  return order
    .map((kind) => ({
      kind,
      label: GROUP_LABEL[kind],
      results: results.filter((result) => result.kind === kind).slice(0, MAX_PER_GROUP),
    }))
    .filter((group) => group.results.length > 0);
}
