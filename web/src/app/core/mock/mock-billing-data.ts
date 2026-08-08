import type { Employee, PermissionSet } from '@core/models/employee.model';
import type { AppNotification } from '@core/models/notification.model';
import type { FeatureModule, Permission } from '@core/models/permission.model';
import { PERMISSIONS } from '@core/models/permission.model';
import type {
  BillingHistory,
  Invoice,
  Payment,
  PlanLimits,
  PlanModules,
  RenewalRecord,
  Subscription,
  SubscriptionPlan,
  SubscriptionSnapshot,
  SupportLevel,
  UsageMetric,
} from '@core/models/subscription.model';
import { EMPLOYEE_DEFAULT_PERMISSIONS } from './mock-tokens';

const NOW = new Date();

function offsetDays(days: number): string {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function initialsOf(name: string): string {
  const parts = name.split(' ');
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

function modules(enabled: readonly FeatureModule[]): PlanModules {
  return {
    whatsapp: enabled.includes('whatsapp'),
    email: enabled.includes('email'),
    social: enabled.includes('social'),
    crm: enabled.includes('crm'),
    reporting: enabled.includes('reporting'),
    ai: enabled.includes('ai'),
    api: enabled.includes('api'),
    employees: enabled.includes('employees'),
  };
}

interface PlanSeed {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly monthly: number;
  readonly yearly: number;
  readonly trialDays: number;
  readonly discountPercent: number;
  readonly promotional: boolean;
  readonly popular: boolean;
  readonly recommended: boolean;
  readonly support: SupportLevel;
  readonly enabled: readonly FeatureModule[];
  readonly limits: PlanLimits;
  readonly highlights: readonly string[];
}

const PLAN_SEEDS: readonly PlanSeed[] = [
  {
    id: 'plan_starter',
    name: 'Starter',
    tagline: 'For small teams sending their first campaigns.',
    monthly: 29,
    yearly: 290,
    trialDays: 14,
    discountPercent: 0,
    promotional: false,
    popular: false,
    recommended: false,
    support: 'community',
    enabled: ['whatsapp', 'crm'],
    limits: {
      maxEmployees: 3,
      maxContacts: 2_500,
      maxCampaigns: 10,
      maxWhatsAppAccounts: 1,
      maxEmailAccounts: 0,
      maxSocialAccounts: 0,
      maxApiCallsPerMonth: 0,
      maxStorageMb: 2_048,
      dailyMessageLimit: 1_000,
      monthlyMessageLimit: 25_000,
    },
    highlights: [
      'WhatsApp campaigns',
      'Contact management',
      'Basic delivery reports',
      'Community support',
    ],
  },
  {
    id: 'plan_growth',
    name: 'Growth',
    tagline: 'For growing teams running multi-channel campaigns.',
    monthly: 89,
    yearly: 890,
    trialDays: 14,
    discountPercent: 0,
    promotional: false,
    popular: true,
    recommended: false,
    support: 'email',
    enabled: ['whatsapp', 'email', 'crm', 'reporting', 'employees'],
    limits: {
      maxEmployees: 10,
      maxContacts: 25_000,
      maxCampaigns: 100,
      maxWhatsAppAccounts: 2,
      maxEmailAccounts: 2,
      maxSocialAccounts: 0,
      maxApiCallsPerMonth: 50_000,
      maxStorageMb: 20_480,
      dailyMessageLimit: 10_000,
      monthlyMessageLimit: 200_000,
    },
    highlights: [
      'Everything in Starter',
      'Email marketing',
      'Advanced reporting',
      'Employee management',
      'Email support',
    ],
  },
  {
    id: 'plan_scale',
    name: 'Scale',
    tagline: 'For marketing teams that need automation and API access.',
    monthly: 249,
    yearly: 2_490,
    trialDays: 30,
    discountPercent: 0,
    promotional: false,
    popular: false,
    recommended: true,
    support: 'priority',
    enabled: ['whatsapp', 'email', 'social', 'crm', 'reporting', 'ai', 'api', 'employees'],
    limits: {
      maxEmployees: 50,
      maxContacts: 150_000,
      maxCampaigns: 1_000,
      maxWhatsAppAccounts: 5,
      maxEmailAccounts: 10,
      maxSocialAccounts: 8,
      maxApiCallsPerMonth: 500_000,
      maxStorageMb: 102_400,
      dailyMessageLimit: 100_000,
      monthlyMessageLimit: 2_000_000,
    },
    highlights: [
      'Everything in Growth',
      'Social media automation',
      'AI content assistance',
      'Full REST API access',
      'Priority support',
    ],
  },
  {
    id: 'plan_enterprise',
    name: 'Enterprise',
    tagline: 'Unlimited scale with a dedicated success manager.',
    monthly: 749,
    yearly: 7_490,
    trialDays: 30,
    discountPercent: 0,
    promotional: false,
    popular: false,
    recommended: false,
    support: 'dedicated',
    enabled: ['whatsapp', 'email', 'social', 'crm', 'reporting', 'ai', 'api', 'employees'],
    limits: {
      maxEmployees: null,
      maxContacts: null,
      maxCampaigns: null,
      maxWhatsAppAccounts: 25,
      maxEmailAccounts: 50,
      maxSocialAccounts: 25,
      maxApiCallsPerMonth: null,
      maxStorageMb: 1_048_576,
      dailyMessageLimit: null,
      monthlyMessageLimit: null,
    },
    highlights: [
      'Everything in Scale',
      'Unlimited contacts and campaigns',
      'Custom SLA and onboarding',
      'Dedicated success manager',
      'SSO and audit exports',
    ],
  },
  {
    id: 'plan_launch_promo',
    name: 'Launch Offer',
    tagline: 'Limited-time promotional pricing on the Growth feature set.',
    monthly: 49,
    yearly: 490,
    trialDays: 21,
    discountPercent: 45,
    promotional: true,
    popular: false,
    recommended: false,
    support: 'email',
    enabled: ['whatsapp', 'email', 'crm', 'reporting', 'employees'],
    limits: {
      maxEmployees: 10,
      maxContacts: 25_000,
      maxCampaigns: 100,
      maxWhatsAppAccounts: 2,
      maxEmailAccounts: 2,
      maxSocialAccounts: 0,
      maxApiCallsPerMonth: 50_000,
      maxStorageMb: 20_480,
      dailyMessageLimit: 10_000,
      monthlyMessageLimit: 200_000,
    },
    highlights: [
      'Growth features at 45% off',
      'Locked for 12 months',
      '21-day trial',
      'Email support',
    ],
  },
];

export const PLANS: readonly SubscriptionPlan[] = PLAN_SEEDS.map((seed, index) => ({
  id: seed.id,
  name: seed.name,
  tagline: seed.tagline,
  monthlyPrice: seed.monthly,
  yearlyPrice: seed.yearly,
  currency: 'USD',
  trialDays: seed.trialDays,
  renewalPeriodMonths: 1,
  discountPercent: seed.discountPercent,
  isPromotional: seed.promotional,
  isMostPopular: seed.popular,
  isRecommended: seed.recommended,
  status: seed.promotional ? 'inactive' : 'active',
  supportLevel: seed.support,
  modules: modules(seed.enabled),
  limits: seed.limits,
  highlights: seed.highlights,
  sortOrder: index,
  updatedAt: offsetDays(-(index * 9 + 4)),
}));

/** The signed-in workspace is on Growth, deliberately close to several ceilings. */
const ACTIVE_PLAN = PLANS.find((plan) => plan.id === 'plan_growth') ?? PLANS[0];

const SUBSCRIPTION: Subscription = {
  planId: ACTIVE_PLAN.id,
  planName: ACTIVE_PLAN.name,
  status: 'active',
  billingCycle: 'monthly',
  currentPeriodStart: offsetDays(-12),
  currentPeriodEnd: offsetDays(18),
  nextRenewalAt: offsetDays(18),
  expiresAt: offsetDays(18),
  autoRenew: true,
  trialEndsAt: null,
  seatsPurchased: 10,
  amount: ACTIVE_PLAN.monthlyPrice,
  currency: ACTIVE_PLAN.currency,
};

const USAGE: readonly UsageMetric[] = [
  { key: 'employees', label: 'Employee seats', used: 7, limit: 10, unit: 'seats' },
  { key: 'contacts', label: 'Contacts', used: 18_420, limit: 25_000, unit: 'contacts' },
  { key: 'campaigns', label: 'Campaigns', used: 64, limit: 100, unit: 'campaigns' },
  { key: 'whatsAppAccounts', label: 'WhatsApp accounts', used: 1, limit: 2, unit: 'accounts' },
  { key: 'emailAccounts', label: 'Email accounts', used: 2, limit: 2, unit: 'accounts' },
  { key: 'socialAccounts', label: 'Social accounts', used: 0, limit: 0, unit: 'accounts' },
  { key: 'apiCalls', label: 'API requests', used: 31_800, limit: 50_000, unit: 'requests' },
  { key: 'storage', label: 'Storage', used: 14_680, limit: 20_480, unit: 'MB' },
  { key: 'messagesDaily', label: 'Messages today', used: 4_120, limit: 10_000, unit: 'messages' },
  {
    key: 'messagesMonthly',
    label: 'Messages this month',
    used: 168_400,
    limit: 200_000,
    unit: 'messages',
  },
];

export const SUBSCRIPTION_SNAPSHOT: SubscriptionSnapshot = {
  subscription: SUBSCRIPTION,
  plan: ACTIVE_PLAN,
  usage: USAGE,
};

/* ------------------------------------------------------------------ *
 * Billing history
 * ------------------------------------------------------------------ */
function buildInvoices(count: number): readonly Invoice[] {
  return Array.from({ length: count }, (_, index) => {
    const monthsAgo = index;
    const issued = offsetDays(-(monthsAgo * 30 + 12));
    const isCurrent = index === 0;
    const failed = index === 3;

    return {
      id: `inv_${(count - index).toString().padStart(4, '0')}`,
      number: `NW-2026-${(count - index).toString().padStart(4, '0')}`,
      planName: ACTIVE_PLAN.name,
      billingCycle: 'monthly' as const,
      amount: ACTIVE_PLAN.monthlyPrice,
      tax: Number((ACTIVE_PLAN.monthlyPrice * 0.2).toFixed(2)),
      currency: 'USD',
      status: isCurrent ? ('due' as const) : failed ? ('overdue' as const) : ('paid' as const),
      issuedAt: issued,
      dueAt: offsetDays(-(monthsAgo * 30 - 2)),
      paidAt: isCurrent || failed ? null : offsetDays(-(monthsAgo * 30 + 9)),
      periodStart: offsetDays(-(monthsAgo * 30 + 12)),
      periodEnd: offsetDays(-(monthsAgo * 30 - 18)),
      downloadUrl: `/api/v1/billing/invoices/inv_${(count - index).toString().padStart(4, '0')}/pdf`,
    };
  });
}

const INVOICES = buildInvoices(9);

const PAYMENTS: readonly Payment[] = INVOICES.filter(
  (invoice) => invoice.status === 'paid' || invoice.status === 'overdue',
).map((invoice, index) => ({
  id: `pay_${(index + 1).toString().padStart(4, '0')}`,
  invoiceNumber: invoice.number,
  amount: invoice.amount + invoice.tax,
  currency: invoice.currency,
  status: invoice.status === 'overdue' ? ('failed' as const) : ('succeeded' as const),
  method: 'card' as const,
  cardBrand: 'Visa',
  cardLast4: '4242',
  processedAt: invoice.paidAt ?? invoice.dueAt,
  failureReason:
    invoice.status === 'overdue'
      ? 'Card declined by issuer (insufficient funds). Retry scheduled.'
      : null,
}));

const RENEWALS: readonly RenewalRecord[] = INVOICES.filter(
  (invoice) => invoice.status === 'paid',
).map((invoice, index) => ({
  id: `ren_${(index + 1).toString().padStart(4, '0')}`,
  planName: invoice.planName,
  billingCycle: invoice.billingCycle,
  amount: invoice.amount,
  currency: invoice.currency,
  renewedAt: invoice.paidAt ?? invoice.issuedAt,
  periodEnd: invoice.periodEnd,
  automatic: true,
}));

export const BILLING_HISTORY: BillingHistory = {
  invoices: INVOICES,
  payments: PAYMENTS,
  renewals: RENEWALS,
};

/* ------------------------------------------------------------------ *
 * Employees & permission sets
 * ------------------------------------------------------------------ */
interface EmployeeSeed {
  readonly name: string;
  readonly title: string;
  readonly role: Employee['role'];
  readonly status: Employee['status'];
  readonly permissions: readonly Permission[];
  readonly lastActiveDays: number | null;
}

const CAMPAIGN_MANAGER_PERMISSIONS: readonly Permission[] = [
  ...EMPLOYEE_DEFAULT_PERMISSIONS,
  'whatsapp.campaigns.edit',
  'whatsapp.campaigns.schedule',
  'whatsapp.campaigns.send',
  'whatsapp.campaigns.pause',
  'contacts.import',
  'groups.manage',
  'tags.manage',
  'reports.export',
  'reports.download.csv',
];

const ANALYST_PERMISSIONS: readonly Permission[] = [
  'dashboard.view',
  'dashboard.statistics',
  'dashboard.export',
  'contacts.view',
  'contacts.export',
  'whatsapp.campaigns.reports',
  'reports.view',
  'reports.export',
  'reports.download.csv',
  'reports.download.excel',
  'reports.download.pdf',
];

const EMPLOYEE_SEEDS: readonly EmployeeSeed[] = [
  {
    name: 'Amara Chen',
    title: 'Head of Marketing',
    role: 'Admin',
    status: 'active',
    permissions: PERMISSIONS.filter((p) => !p.startsWith('platform.')),
    lastActiveDays: 0,
  },
  {
    name: 'Diego Rivera',
    title: 'Campaign Manager',
    role: 'Employee',
    status: 'active',
    permissions: CAMPAIGN_MANAGER_PERMISSIONS,
    lastActiveDays: 0,
  },
  {
    name: 'Sofia Moreau',
    title: 'Content Lead',
    role: 'Employee',
    status: 'active',
    permissions: CAMPAIGN_MANAGER_PERMISSIONS,
    lastActiveDays: 1,
  },
  {
    name: 'Kenji Tanaka',
    title: 'Data Analyst',
    role: 'Employee',
    status: 'active',
    permissions: ANALYST_PERMISSIONS,
    lastActiveDays: 2,
  },
  {
    name: 'Leila Haddad',
    title: 'Support Specialist',
    role: 'Employee',
    status: 'active',
    permissions: EMPLOYEE_DEFAULT_PERMISSIONS,
    lastActiveDays: 4,
  },
  {
    name: 'Marcus Bennett',
    title: 'Growth Marketer',
    role: 'Employee',
    status: 'invited',
    permissions: EMPLOYEE_DEFAULT_PERMISSIONS,
    lastActiveDays: null,
  },
  {
    name: 'Ines Duarte',
    title: 'Designer',
    role: 'Employee',
    status: 'suspended',
    permissions: [],
    lastActiveDays: 46,
  },
];

export const EMPLOYEES: readonly Employee[] = EMPLOYEE_SEEDS.map((seed, index) => ({
  id: `emp_${(index + 1).toString().padStart(3, '0')}`,
  name: seed.name,
  initials: initialsOf(seed.name),
  email: `${seed.name.toLowerCase().replace(/[^a-z]/g, '.')}@northwind.com`,
  jobTitle: seed.title,
  role: seed.role,
  status: seed.status,
  permissions: seed.permissions,
  lastActiveAt: seed.lastActiveDays === null ? null : offsetDays(-seed.lastActiveDays),
  invitedAt: offsetDays(-(index * 37 + 20)),
}));

export const PERMISSION_SETS: readonly PermissionSet[] = [
  {
    id: 'pset_admin',
    name: 'Workspace Admin',
    description: 'Full access to every module and setting in this workspace.',
    isSystem: true,
    permissions: PERMISSIONS.filter((p) => !p.startsWith('platform.')),
    assignedCount: 1,
  },
  {
    id: 'pset_campaign',
    name: 'Campaign Manager',
    description: 'Builds and sends campaigns; cannot change billing or the team.',
    isSystem: false,
    permissions: CAMPAIGN_MANAGER_PERMISSIONS,
    assignedCount: 2,
  },
  {
    id: 'pset_analyst',
    name: 'Analyst',
    description: 'Read-only across contacts and campaigns, with full report exports.',
    isSystem: false,
    permissions: ANALYST_PERMISSIONS,
    assignedCount: 1,
  },
  {
    id: 'pset_base',
    name: 'Employee (default)',
    description: 'The starting grant for a newly invited employee.',
    isSystem: true,
    permissions: EMPLOYEE_DEFAULT_PERMISSIONS,
    assignedCount: 2,
  },
];

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */
interface NotificationSeed {
  readonly kind: AppNotification['kind'];
  readonly title: string;
  readonly body: string;
  readonly priority: AppNotification['priority'];
  readonly icon: AppNotification['icon'];
  readonly read: boolean;
  readonly actionLabel: string | null;
  readonly actionRoute: string | null;
  readonly hoursAgo: number;
}

const NOTIFICATION_SEEDS: readonly NotificationSeed[] = [
  {
    kind: 'subscription.expiring',
    title: 'Subscription renews in 18 days',
    body: 'Your Growth plan renews automatically on the next billing date.',
    priority: 'warning',
    icon: 'creditCard',
    read: false,
    actionLabel: 'Manage billing',
    actionRoute: '/billing',
    hoursAgo: 3,
  },
  {
    kind: 'messages.limit',
    title: 'Monthly message limit 84% used',
    body: '168,400 of 200,000 messages sent this cycle. Consider upgrading before the reset.',
    priority: 'warning',
    icon: 'send',
    read: false,
    actionLabel: 'Upgrade plan',
    actionRoute: '/pricing',
    hoursAgo: 5,
  },
  {
    kind: 'payment.failed',
    title: 'Payment failed',
    body: 'Card ending 4242 was declined for invoice NW-2026-0006.',
    priority: 'critical',
    icon: 'warning',
    read: false,
    actionLabel: 'Retry payment',
    actionRoute: '/billing',
    hoursAgo: 9,
  },
  {
    kind: 'campaign.completed',
    title: 'Campaign completed',
    body: 'Back in Stock — Linen Range finished sending to 41,870 contacts.',
    priority: 'success',
    icon: 'checkCircle',
    read: false,
    actionLabel: 'View report',
    actionRoute: '/reports',
    hoursAgo: 14,
  },
  {
    kind: 'whatsapp.token.expiring',
    title: 'WhatsApp access token expires soon',
    body: 'Reauthorise with Meta within 7 days to avoid interrupted sending.',
    priority: 'warning',
    icon: 'chat',
    read: false,
    actionLabel: 'Reconnect',
    actionRoute: '/whatsapp',
    hoursAgo: 26,
  },
  {
    kind: 'storage.limit',
    title: 'Storage 72% used',
    body: '14.3 GB of 20 GB consumed by media assets and exports.',
    priority: 'info',
    icon: 'database',
    read: true,
    actionLabel: 'View usage',
    actionRoute: '/subscription',
    hoursAgo: 32,
  },
  {
    kind: 'employee.invited',
    title: 'New employee invited',
    body: 'Marcus Bennett was invited as an Employee and has not signed in yet.',
    priority: 'info',
    icon: 'users',
    read: true,
    actionLabel: 'Manage team',
    actionRoute: '/employees',
    hoursAgo: 40,
  },
  {
    kind: 'campaign.failed',
    title: 'Campaign failed',
    body: 'Flash Deal Weekend stopped after 61% of messages were rejected by Meta.',
    priority: 'critical',
    icon: 'xCircle',
    read: true,
    actionLabel: 'View failures',
    actionRoute: '/reports',
    hoursAgo: 54,
  },
  {
    kind: 'payment.received',
    title: 'Payment received',
    body: '$106.80 paid successfully for invoice NW-2026-0008.',
    priority: 'success',
    icon: 'creditCard',
    read: true,
    actionLabel: 'View invoice',
    actionRoute: '/billing',
    hoursAgo: 72,
  },
  {
    kind: 'meta.disconnected',
    title: 'Meta Business connection restored',
    body: 'The Cloud API bridge reconnected after a brief interruption.',
    priority: 'info',
    icon: 'shield',
    read: true,
    actionLabel: null,
    actionRoute: null,
    hoursAgo: 96,
  },
  {
    kind: 'contacts.limit',
    title: 'Contact limit 74% used',
    body: '18,420 of 25,000 contacts stored on the Growth plan.',
    priority: 'info',
    icon: 'users',
    read: true,
    actionLabel: 'View usage',
    actionRoute: '/subscription',
    hoursAgo: 120,
  },
  {
    kind: 'plan.upgraded',
    title: 'Plan upgraded to Growth',
    body: 'Your workspace moved from Starter to Growth. New limits applied immediately.',
    priority: 'success',
    icon: 'trendingUp',
    read: true,
    actionLabel: 'View plan',
    actionRoute: '/subscription',
    hoursAgo: 168,
  },
];

export const NOTIFICATIONS: readonly AppNotification[] = NOTIFICATION_SEEDS.map((seed, index) => {
  const occurred = new Date(NOW);
  occurred.setUTCHours(occurred.getUTCHours() - seed.hoursAgo);

  return {
    id: `ntf_${(index + 1).toString().padStart(3, '0')}`,
    kind: seed.kind,
    title: seed.title,
    body: seed.body,
    priority: seed.priority,
    icon: seed.icon,
    read: seed.read,
    actionLabel: seed.actionLabel,
    actionRoute: seed.actionRoute,
    occurredAt: occurred.toISOString(),
  };
});
