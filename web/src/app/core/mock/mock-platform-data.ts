import type {
  AdminAccount,
  AdminLeaderboardRow,
  PlanBreakdown,
  PlatformOverview,
  PlatformTrendPoint,
} from '@core/models/admin-account.model';
import type { DashboardSnapshot, TrendPoint } from '@core/models/analytics.model';
import type { Campaign } from '@core/models/campaign.model';
import type { Contact } from '@core/models/contact.model';
import type { Employee } from '@core/models/employee.model';
import type { TenantPlan, TenantStatus } from '@core/models/platform.model';
import type { WhatsAppConnection } from '@core/models/whatsapp.model';
import { CAMPAIGNS, CONTACTS, DASHBOARD, WHATSAPP_CONNECTION } from './mock-data';
import { EMPLOYEES } from './mock-billing-data';

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

/**
 * Stable hash of an id, used to derive per-admin figures.
 * Deterministic so an admin's numbers never change between requests.
 */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result);
}

/** A 0–1 factor derived from an admin id and a salt. */
function factor(adminId: string, salt: string, min: number, max: number): number {
  const ratio = (hash(`${adminId}:${salt}`) % 1000) / 1000;
  return min + ratio * (max - min);
}

interface AdminSeed {
  readonly name: string;
  readonly organisation: string;
  readonly plan: TenantPlan;
  readonly status: TenantStatus;
}

const ADMIN_SEEDS: readonly AdminSeed[] = [
  { name: 'Amara Chen', organisation: 'Northwind Retail', plan: 'growth', status: 'active' },
  { name: 'Tomas Novak', organisation: 'Lumen Health', plan: 'enterprise', status: 'active' },
  { name: 'Aisha Ahmed', organisation: 'Fable Books', plan: 'starter', status: 'active' },
  { name: 'Lucas Ferreira', organisation: 'Orbit Logistics', plan: 'scale', status: 'active' },
  { name: 'Mei Nakamura', organisation: 'Verde Grocers', plan: 'growth', status: 'trialing' },
  { name: 'Ravi Kaur', organisation: 'Atlas Fitness', plan: 'starter', status: 'active' },
  { name: 'Clara Weber', organisation: 'Kite Travel', plan: 'scale', status: 'suspended' },
  { name: 'Elias Osei', organisation: 'Harbour Bank', plan: 'enterprise', status: 'active' },
];

export const ADMIN_ACCOUNTS: readonly AdminAccount[] = ADMIN_SEEDS.map((seed, index) => {
  const id = `adm_${(index + 1).toString().padStart(3, '0')}`;
  const scale = seed.plan === 'enterprise' ? 4 : seed.plan === 'scale' ? 2.4 : seed.plan === 'growth' ? 1 : 0.4;

  const contactCount = Math.round(factor(id, 'contacts', 1_800, 24_000) * scale);
  const customerCount = Math.round(contactCount * factor(id, 'customers', 0.18, 0.42));
  const leadCount = Math.round(contactCount * factor(id, 'leads', 0.22, 0.55));

  return {
    id,
    name: seed.name,
    initials: initialsOf(seed.name),
    email: `${seed.name.toLowerCase().replace(/[^a-z]/g, '.')}@${seed.organisation
      .toLowerCase()
      .replace(/[^a-z]/g, '')}.com`,
    organisation: seed.organisation,
    plan: seed.plan,
    status: seed.status,
    employeeCount: Math.max(2, Math.round(factor(id, 'employees', 3, 48) * (scale / 2 + 0.5))),
    contactCount,
    campaignCount: Math.round(factor(id, 'campaigns', 6, 140) * (scale / 2 + 0.5)),
    leadCount,
    customerCount,
    messagesThisMonth: Math.round(factor(id, 'messages', 12_000, 320_000) * scale),
    lastActiveAt: offsetDays(-Math.floor(factor(id, 'active', 0, 9))),
    createdAt: offsetDays(-Math.floor(factor(id, 'created', 40, 900))),
  };
});

const ADMIN_BY_ID = new Map(ADMIN_ACCOUNTS.map((admin) => [admin.id, admin] as const));

export function findAdmin(adminId: string): AdminAccount | undefined {
  return ADMIN_BY_ID.get(adminId);
}

/* ------------------------------------------------------------------ *
 * Platform-wide aggregates
 * ------------------------------------------------------------------ */
const PLAN_PRICE: Readonly<Record<TenantPlan, number>> = {
  starter: 29,
  growth: 89,
  scale: 249,
  enterprise: 749,
};

function buildPlatformTrend(days: number): readonly PlatformTrendPoint[] {
  const points: PlatformTrendPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - offset);
    const weekday = date.getUTCDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.6 : 1;
    const key = date.toISOString().slice(0, 10);

    points.push({
      date: key,
      messages: Math.round(factor(key, 'msg', 480_000, 720_000) * weekendFactor),
      customers: Math.round(factor(key, 'cust', 180, 420) * weekendFactor),
    });
  }

  return points;
}

const PLAN_BREAKDOWN: readonly PlanBreakdown[] = (
  ['starter', 'growth', 'scale', 'enterprise'] as const
).map((plan) => {
  const admins = ADMIN_ACCOUNTS.filter((admin) => admin.plan === plan);
  return {
    plan,
    adminCount: admins.length,
    monthlyRevenue: admins.length * PLAN_PRICE[plan],
  };
});

const TOP_ADMINS: readonly AdminLeaderboardRow[] = [...ADMIN_ACCOUNTS]
  .sort((a, b) => b.messagesThisMonth - a.messagesThisMonth)
  .slice(0, 5)
  .map((admin) => ({
    adminId: admin.id,
    name: admin.name,
    organisation: admin.organisation,
    messagesThisMonth: admin.messagesThisMonth,
    deliveryRate: Number((96 + factor(admin.id, 'delivery', 0, 3.4)).toFixed(1)),
  }));

function sum(pick: (admin: AdminAccount) => number): number {
  return ADMIN_ACCOUNTS.reduce((total, admin) => total + pick(admin), 0);
}

export const PLATFORM_OVERVIEW: PlatformOverview = {
  totalAdmins: ADMIN_ACCOUNTS.length,
  activeAdmins: ADMIN_ACCOUNTS.filter((admin) => admin.status === 'active').length,
  totalEmployees: sum((admin) => admin.employeeCount),
  totalCampaigns: sum((admin) => admin.campaignCount),
  totalLeads: sum((admin) => admin.leadCount),
  totalCustomers: sum((admin) => admin.customerCount),
  totalContacts: sum((admin) => admin.contactCount),
  totalMessagesThisMonth: sum((admin) => admin.messagesThisMonth),
  messagesDelta: 9.4,
  customersDelta: 6.8,
  leadsDelta: 11.2,
  campaignsDelta: 4.1,
  trend: buildPlatformTrend(30),
  planBreakdown: PLAN_BREAKDOWN,
  topAdmins: TOP_ADMINS,
};

/* ------------------------------------------------------------------ *
 * Per-admin slices
 *
 * Records are partitioned deterministically across admins so each account
 * shows a genuinely different — but stable — subset of the seeded dataset.
 * ------------------------------------------------------------------ */
function bucketFor(id: string): number {
  return hash(id) % ADMIN_ACCOUNTS.length;
}

function adminIndex(adminId: string): number {
  return ADMIN_ACCOUNTS.findIndex((admin) => admin.id === adminId);
}

export function contactsForAdmin(adminId: string): readonly Contact[] {
  const index = adminIndex(adminId);
  return index === -1 ? [] : CONTACTS.filter((contact) => bucketFor(contact.id) === index);
}

export function campaignsForAdmin(adminId: string): readonly Campaign[] {
  const index = adminIndex(adminId);
  if (index === -1) {
    return [];
  }
  // Campaigns are few, so rotate rather than bucket to avoid empty accounts.
  return CAMPAIGNS.filter((_, position) => position % ADMIN_ACCOUNTS.length === index % ADMIN_ACCOUNTS.length);
}

export function employeesForAdmin(adminId: string): readonly Employee[] {
  const admin = findAdmin(adminId);
  if (admin === undefined) {
    return [];
  }

  // Reuse the seeded people, resized to this admin's headcount.
  const wanted = Math.min(admin.employeeCount, EMPLOYEES.length);
  return EMPLOYEES.slice(0, Math.max(2, wanted)).map((employee, position) => ({
    ...employee,
    id: `${adminId}_${employee.id}`,
    email: employee.email.replace(
      /@.+$/,
      `@${admin.organisation.toLowerCase().replace(/[^a-z]/g, '')}.com`,
    ),
    status: position === 0 ? ('active' as const) : employee.status,
  }));
}

/** The selected admin's WhatsApp connection, so the header reads correctly. */
export function connectionForAdmin(adminId: string): WhatsAppConnection {
  const admin = findAdmin(adminId);
  if (admin === undefined) {
    return WHATSAPP_CONNECTION;
  }

  const limit = admin.plan === 'enterprise' ? 1_000_000 : admin.plan === 'scale' ? 100_000 : 10_000;

  return {
    ...WHATSAPP_CONNECTION,
    status: admin.status === 'suspended' ? 'error' : 'connected',
    verifiedName: admin.organisation,
    displayPhoneNumber: `+44 7700 9${String(100_000 + (hash(admin.id) % 899_999)).slice(0, 5)}`,
    businessProfileAbout: `Order updates and offers from ${admin.organisation}.`,
    qualityRating: admin.status === 'suspended' ? 'red' : 'green',
    messagingLimit: limit,
    messagesLast24h: Math.round(Math.min(limit * 0.92, admin.messagesThisMonth / 30)),
    webhookHealthy: admin.status !== 'suspended',
    templateNamespaceAlias: admin.organisation.toLowerCase().replace(/[^a-z]/g, '_'),
    connectedAt: admin.createdAt,
  };
}

/** The selected admin's dashboard, scaled from the shared shape. */
export function dashboardForAdmin(adminId: string): DashboardSnapshot {
  const admin = findAdmin(adminId);
  if (admin === undefined) {
    return DASHBOARD;
  }

  const ratio = admin.messagesThisMonth / 300_000;

  const trend: readonly TrendPoint[] = DASHBOARD.trend.map((point) => ({
    date: point.date,
    sent: Math.round(point.sent * ratio),
    delivered: Math.round(point.delivered * ratio),
    read: Math.round(point.read * ratio),
  }));

  const sent = trend.reduce((total, point) => total + point.sent, 0);
  const delivered = trend.reduce((total, point) => total + point.delivered, 0);
  const read = trend.reduce((total, point) => total + point.read, 0);
  const clicked = Math.round(read * 0.213);

  return {
    kpis: {
      messagesSent: sent,
      delivered,
      read,
      failed: sent - delivered,
      clickThroughRate: delivered === 0 ? 0 : Number(((clicked / delivered) * 100).toFixed(1)),
      messagesSentDelta: Number((factor(adminId, 'd1', -8, 22)).toFixed(1)),
      deliveredDelta: Number((factor(adminId, 'd2', -6, 20)).toFixed(1)),
      readDelta: Number((factor(adminId, 'd3', -10, 16)).toFixed(1)),
      failedDelta: Number((factor(adminId, 'd4', -25, 8)).toFixed(1)),
      clickThroughRateDelta: Number((factor(adminId, 'd5', -4, 9)).toFixed(1)),
    },
    trend,
    funnel: [
      { label: 'Sent', value: sent },
      { label: 'Delivered', value: delivered },
      { label: 'Read', value: read },
      { label: 'Clicked', value: clicked },
    ],
    activity: DASHBOARD.activity,
  };
}
