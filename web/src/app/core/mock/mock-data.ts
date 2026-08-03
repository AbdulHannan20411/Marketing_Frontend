import type {
  ActivityEntry,
  DashboardSnapshot,
  FunnelStage,
  KpiSummary,
  TrendPoint,
} from '@core/models/analytics.model';
import type {
  Campaign,
  CampaignStatus,
  DeliveryFailure,
  FailureReason,
} from '@core/models/campaign.model';
import type {
  Contact,
  ContactGroup,
  ContactStatus,
  ContactTag,
  TagColor,
} from '@core/models/contact.model';
import type {
  AuditLogEntry,
  AuditSeverity,
  SystemSnapshot,
  Tenant,
  TenantPlan,
  TenantStatus,
} from '@core/models/platform.model';
import type {
  MessageTemplate,
  TemplateCategory,
  TemplateStatus,
  WhatsAppConnection,
} from '@core/models/whatsapp.model';

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-randomness.
 * A fixed seed keeps the demo dataset identical across reloads, so
 * screenshots, counts and charts stay comparable between sessions.
 * ------------------------------------------------------------------ */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20260804);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function between(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/**
 * Anchored to load time, not a fixed date: every timestamp below is expressed
 * as an offset from "now", so relative labels ("3 hours ago") stay truthful.
 * The seeded RNG above is what keeps volumes and names stable.
 */
const NOW = new Date();

function daysAgo(days: number, hourOffset = 0): string {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(date.getUTCHours() - hourOffset);
  return date.toISOString();
}

function daysAhead(days: number, hour = 10): string {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function initialsOf(name: string): string {
  const parts = name.split(' ');
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

/* ------------------------------------------------------------------ *
 * Source vocabulary
 * ------------------------------------------------------------------ */
const FIRST_NAMES = [
  'Amara', 'Diego', 'Priya', 'Noah', 'Leila', 'Marcus', 'Sofia', 'Kenji', 'Fatima', 'Oliver',
  'Ines', 'Tomas', 'Aisha', 'Lucas', 'Mei', 'Ravi', 'Clara', 'Sebastian', 'Nadia', 'Elias',
  'Zara', 'Hugo', 'Anaya', 'Felix', 'Yusuf', 'Camila', 'Arjun', 'Elena', 'Mateo', 'Rania',
];

const LAST_NAMES = [
  'Chen', 'Rivera', 'Raman', 'Okafor', 'Haddad', 'Bennett', 'Moreau', 'Tanaka', 'Silva', 'Novak',
  'Ferreira', 'Kowalski', 'Ahmed', 'Rossi', 'Lindqvist', 'Duarte', 'Nakamura', 'Osei', 'Weber',
  'Kaur',
];

const COUNTRIES = [
  { name: 'United Kingdom', dial: '+44', prefix: '7700 9' },
  { name: 'Spain', dial: '+34', prefix: '6' },
  { name: 'Brazil', dial: '+55', prefix: '11 9' },
  { name: 'India', dial: '+91', prefix: '98' },
  { name: 'Germany', dial: '+49', prefix: '15' },
  { name: 'Nigeria', dial: '+234', prefix: '80' },
  { name: 'Mexico', dial: '+52', prefix: '55' },
];

const CONTACT_STATUSES: readonly ContactStatus[] = [
  'subscribed', 'subscribed', 'subscribed', 'subscribed',
  'subscribed', 'subscribed', 'unsubscribed', 'blocked',
];

/* ------------------------------------------------------------------ *
 * Tags & groups
 * ------------------------------------------------------------------ */
const TAG_SEED: readonly { name: string; color: TagColor }[] = [
  { name: 'VIP', color: 'brand' },
  { name: 'Newsletter', color: 'info' },
  { name: 'Cart abandoner', color: 'warning' },
  { name: 'High value', color: 'brand' },
  { name: 'Trial', color: 'neutral' },
  { name: 'Churn risk', color: 'danger' },
  { name: 'Beta tester', color: 'info' },
  { name: 'Wholesale', color: 'neutral' },
];

export const TAGS: readonly ContactTag[] = TAG_SEED.map((seed, index) => ({
  id: `tag_${index + 1}`,
  name: seed.name,
  color: seed.color,
  contactCount: 0,
  createdAt: daysAgo(between(40, 400)),
}));

const GROUP_SEED: readonly { name: string; description: string }[] = [
  { name: 'All customers', description: 'Every opted-in contact across all regions.' },
  { name: 'Loyalty members', description: 'Enrolled in the rewards programme.' },
  { name: 'New this quarter', description: 'Joined within the last 90 days.' },
  { name: 'Lapsed buyers', description: 'No purchase in the last 6 months.' },
  { name: 'EU region', description: 'Contacts based in EU member states.' },
  { name: 'Wholesale partners', description: 'B2B accounts with bulk pricing.' },
];

export const GROUPS: readonly ContactGroup[] = GROUP_SEED.map((seed, index) => ({
  id: `grp_${index + 1}`,
  name: seed.name,
  description: seed.description,
  contactCount: 0,
  createdAt: daysAgo(between(60, 500)),
  updatedAt: daysAgo(between(0, 30)),
}));

/* ------------------------------------------------------------------ *
 * Contacts
 * ------------------------------------------------------------------ */
function buildContacts(count: number): readonly Contact[] {
  const contacts: Contact[] = [];

  for (let index = 0; index < count; index++) {
    const fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const country = pick(COUNTRIES);
    const status = pick(CONTACT_STATUSES);
    const createdDaysAgo = between(1, 540);

    const tagIds = TAGS.filter(() => random() < 0.22).map((tag) => tag.id);
    const groupIds = GROUPS.filter((_, groupIndex) => groupIndex === 0 || random() < 0.25).map(
      (group) => group.id,
    );

    contacts.push({
      id: `cnt_${(index + 1).toString().padStart(4, '0')}`,
      fullName,
      initials: initialsOf(fullName),
      phoneNumber: `${country.dial} ${country.prefix}${between(10000, 99999)}`,
      email:
        random() < 0.78
          ? `${fullName.toLowerCase().replace(/[^a-z]/g, '.')}@example.com`
          : null,
      country: country.name,
      status,
      tagIds,
      groupIds,
      optedInAt: status === 'subscribed' ? daysAgo(createdDaysAgo) : null,
      lastMessagedAt: random() < 0.85 ? daysAgo(between(0, 45), between(0, 20)) : null,
      createdAt: daysAgo(createdDaysAgo),
    });
  }

  return contacts;
}

export const CONTACTS: readonly Contact[] = buildContacts(148);

/** Counts are derived from the contact set so the UI never contradicts itself. */
export const TAGS_WITH_COUNTS: readonly ContactTag[] = TAGS.map((tag) => ({
  ...tag,
  contactCount: CONTACTS.filter((contact) => contact.tagIds.includes(tag.id)).length,
}));

export const GROUPS_WITH_COUNTS: readonly ContactGroup[] = GROUPS.map((group) => ({
  ...group,
  contactCount: CONTACTS.filter((contact) => contact.groupIds.includes(group.id)).length,
}));

/* ------------------------------------------------------------------ *
 * WhatsApp connection
 * ------------------------------------------------------------------ */
export const WHATSAPP_CONNECTION: WhatsAppConnection = {
  status: 'connected',
  displayPhoneNumber: '+44 7700 900412',
  verifiedName: 'Northwind Retail',
  businessProfileAbout: 'Order updates, offers and support — 9am to 6pm GMT.',
  businessCategory: 'Retail',
  qualityRating: 'green',
  messagingLimit: 100000,
  messagesLast24h: 41280,
  connectedAt: daysAgo(214),
  webhookHealthy: true,
  templateNamespaceAlias: 'northwind_retail',
};

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */
interface TemplateSeed {
  readonly name: string;
  readonly category: TemplateCategory;
  readonly status: TemplateStatus;
  readonly header: string | null;
  readonly body: string;
  readonly footer: string | null;
  readonly variables: readonly string[];
  readonly buttons: readonly string[];
}

const TEMPLATE_SEED: readonly TemplateSeed[] = [
  {
    name: 'order_shipped_v3',
    category: 'utility',
    status: 'approved',
    header: 'Your order is on its way',
    body: 'Hi {{1}}, great news — order {{2}} has shipped and should arrive by {{3}}. Track it any time from your account.',
    footer: 'Northwind Retail',
    variables: ['first_name', 'order_number', 'delivery_date'],
    buttons: ['Track order', 'Contact support'],
  },
  {
    name: 'summer_sale_launch',
    category: 'marketing',
    status: 'approved',
    header: 'Summer sale starts now',
    body: 'Hi {{1}}, our summer sale is live with up to {{2}}% off everything. Your early-access window closes {{3}}.',
    footer: 'Reply STOP to opt out',
    variables: ['first_name', 'discount', 'end_date'],
    buttons: ['Shop the sale'],
  },
  {
    name: 'abandoned_cart_reminder',
    category: 'marketing',
    status: 'approved',
    header: null,
    body: 'Still thinking it over, {{1}}? Your {{2}} is waiting in your basket. We have held it for another 24 hours.',
    footer: 'Reply STOP to opt out',
    variables: ['first_name', 'product_name'],
    buttons: ['Complete checkout'],
  },
  {
    name: 'appointment_reminder',
    category: 'utility',
    status: 'approved',
    header: 'Appointment reminder',
    body: 'Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}. Reply RESCHEDULE if you need a different time.',
    footer: null,
    variables: ['first_name', 'date', 'time'],
    buttons: ['Confirm', 'Reschedule'],
  },
  {
    name: 'login_verification_code',
    category: 'authentication',
    status: 'approved',
    header: null,
    body: '{{1}} is your verification code. For your security, do not share this code with anyone.',
    footer: 'This code expires in 10 minutes',
    variables: ['code'],
    buttons: ['Copy code'],
  },
  {
    name: 'loyalty_points_update',
    category: 'marketing',
    status: 'pending',
    header: 'You have points to spend',
    body: 'Hi {{1}}, you have earned {{2}} points this month. That is worth {{3}} off your next order.',
    footer: 'Reply STOP to opt out',
    variables: ['first_name', 'points', 'value'],
    buttons: ['Redeem now'],
  },
  {
    name: 'back_in_stock_alert',
    category: 'marketing',
    status: 'approved',
    header: null,
    body: 'Good news {{1}} — {{2}} is back in stock. Limited quantities available.',
    footer: 'Reply STOP to opt out',
    variables: ['first_name', 'product_name'],
    buttons: ['Buy now'],
  },
  {
    name: 'flash_deal_blast',
    category: 'marketing',
    status: 'rejected',
    header: 'ACT NOW — 90% OFF!!!',
    body: 'HURRY {{1}}!!! This deal disappears in minutes. Click immediately to claim {{2}}.',
    footer: null,
    variables: ['first_name', 'offer'],
    buttons: ['Claim now'],
  },
  {
    name: 'feedback_request',
    category: 'utility',
    status: 'paused',
    header: null,
    body: 'Hi {{1}}, how did we do with order {{2}}? Your feedback takes 30 seconds and helps us improve.',
    footer: 'Northwind Retail',
    variables: ['first_name', 'order_number'],
    buttons: ['Leave feedback'],
  },
];

export const TEMPLATES: readonly MessageTemplate[] = TEMPLATE_SEED.map((seed, index) => ({
  id: `tpl_${index + 1}`,
  name: seed.name,
  category: seed.category,
  status: seed.status,
  language: 'en_GB',
  headerText: seed.header,
  bodyText: seed.body,
  footerText: seed.footer,
  variables: seed.variables,
  buttons: seed.buttons,
  qualityScore: seed.status === 'rejected' ? 'red' : seed.status === 'paused' ? 'yellow' : 'green',
  timesUsed: seed.status === 'approved' ? between(4, 180) : between(0, 3),
  updatedAt: daysAgo(between(0, 90)),
  rejectionReason:
    seed.status === 'rejected'
      ? 'Content does not comply with Meta commerce policy: misleading urgency and unsubstantiated discount claims.'
      : null,
}));

/* ------------------------------------------------------------------ *
 * Campaigns
 * ------------------------------------------------------------------ */
const CAMPAIGN_SEED: readonly { name: string; template: string; status: CampaignStatus; audience: string }[] = [
  { name: 'Summer Sale — Early Access', template: 'summer_sale_launch', status: 'completed', audience: 'Loyalty members' },
  { name: 'Cart Recovery — July', template: 'abandoned_cart_reminder', status: 'completed', audience: 'Cart abandoners' },
  { name: 'Back in Stock — Linen Range', template: 'back_in_stock_alert', status: 'completed', audience: 'All customers' },
  { name: 'Loyalty Points Reminder', template: 'loyalty_points_update', status: 'sending', audience: 'Loyalty members' },
  { name: 'August Restock Announcement', template: 'back_in_stock_alert', status: 'scheduled', audience: 'All customers' },
  { name: 'Wholesale Price List Update', template: 'order_shipped_v3', status: 'scheduled', audience: 'Wholesale partners' },
  { name: 'Win-back — Lapsed Buyers', template: 'abandoned_cart_reminder', status: 'draft', audience: 'Lapsed buyers' },
  { name: 'Autumn Preview', template: 'summer_sale_launch', status: 'draft', audience: 'VIP' },
  { name: 'Delivery Delay Notice', template: 'order_shipped_v3', status: 'completed', audience: 'EU region' },
  { name: 'Spring Clearance', template: 'summer_sale_launch', status: 'completed', audience: 'All customers' },
  { name: 'Feedback Push — Q2', template: 'feedback_request', status: 'paused', audience: 'New this quarter' },
  { name: 'Flash Deal Weekend', template: 'flash_deal_blast', status: 'failed', audience: 'All customers' },
  { name: 'Appointment Reminders — Week 31', template: 'appointment_reminder', status: 'completed', audience: 'All customers' },
  { name: 'New Arrivals — VIP Preview', template: 'back_in_stock_alert', status: 'completed', audience: 'VIP' },
];

function buildCampaign(
  seed: (typeof CAMPAIGN_SEED)[number],
  index: number,
  owners: readonly string[],
): Campaign {
  const audienceSize = between(1800, 46000);
  const isFinished = seed.status === 'completed';
  const isFailed = seed.status === 'failed';

  const sent = isFinished ? audienceSize : seed.status === 'sending' ? Math.floor(audienceSize * 0.42) : isFailed ? Math.floor(audienceSize * 0.08) : 0;
  const failed = sent === 0 ? 0 : isFailed ? Math.floor(sent * 0.61) : Math.floor(sent * (0.008 + random() * 0.02));
  const delivered = sent - failed;
  const read = Math.floor(delivered * (0.62 + random() * 0.22));
  const clicked = Math.floor(read * (0.11 + random() * 0.19));

  const scheduledDaysAhead = seed.status === 'scheduled' ? between(1, 12) : 0;

  return {
    id: `cmp_${(index + 1).toString().padStart(3, '0')}`,
    name: seed.name,
    templateName: seed.template,
    status: seed.status,
    audienceLabel: seed.audience,
    metrics: { audienceSize, sent, delivered, read, clicked, failed },
    scheduledAt: seed.status === 'scheduled' ? daysAhead(scheduledDaysAhead, between(9, 18)) : null,
    completedAt: isFinished ? daysAgo(between(1, 60)) : null,
    createdBy: pick(owners),
    createdAt: daysAgo(between(2, 120)),
  };
}

const CAMPAIGN_OWNERS = ['Amara Chen', 'Diego Rivera', 'Sofia Moreau'];

export const CAMPAIGNS: readonly Campaign[] = CAMPAIGN_SEED.map((seed, index) =>
  buildCampaign(seed, index, CAMPAIGN_OWNERS),
);

/* ------------------------------------------------------------------ *
 * Delivery failures
 * ------------------------------------------------------------------ */
const FAILURE_REASONS: readonly { reason: FailureReason; code: number }[] = [
  { reason: 'Invalid phone number', code: 131026 },
  { reason: 'Recipient opted out', code: 131047 },
  { reason: 'Template paused by Meta', code: 132015 },
  { reason: 'Rate limit exceeded', code: 130429 },
  { reason: 'Message undeliverable', code: 131053 },
];

export const DELIVERY_FAILURES: readonly DeliveryFailure[] = Array.from(
  { length: 42 },
  (_, index) => {
    const failure = pick(FAILURE_REASONS);
    const contact = pick(CONTACTS);
    return {
      id: `fail_${(index + 1).toString().padStart(3, '0')}`,
      campaignName: pick(CAMPAIGNS).name,
      contactName: contact.fullName,
      phoneNumber: contact.phoneNumber,
      reason: failure.reason,
      errorCode: failure.code,
      occurredAt: daysAgo(between(0, 21), between(0, 23)),
    };
  },
);

/* ------------------------------------------------------------------ *
 * Dashboard analytics
 * ------------------------------------------------------------------ */
function buildTrend(days: number): readonly TrendPoint[] {
  const points: TrendPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - offset);
    const weekday = date.getUTCDay();
    // Weekends run materially quieter — makes the chart read like real traffic.
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.55 : 1;
    const sent = Math.floor((9000 + random() * 7000) * weekendFactor);
    const delivered = Math.floor(sent * (0.965 + random() * 0.025));
    const read = Math.floor(delivered * (0.66 + random() * 0.16));

    points.push({ date: date.toISOString().slice(0, 10), sent, delivered, read });
  }

  return points;
}

const TREND = buildTrend(30);

const TOTAL_SENT = TREND.reduce((sum, point) => sum + point.sent, 0);
const TOTAL_DELIVERED = TREND.reduce((sum, point) => sum + point.delivered, 0);
const TOTAL_READ = TREND.reduce((sum, point) => sum + point.read, 0);
const TOTAL_FAILED = TOTAL_SENT - TOTAL_DELIVERED;
const TOTAL_CLICKED = Math.floor(TOTAL_READ * 0.213);

const KPIS: KpiSummary = {
  messagesSent: TOTAL_SENT,
  delivered: TOTAL_DELIVERED,
  read: TOTAL_READ,
  failed: TOTAL_FAILED,
  clickThroughRate: Number(((TOTAL_CLICKED / TOTAL_DELIVERED) * 100).toFixed(1)),
  messagesSentDelta: 12.4,
  deliveredDelta: 11.8,
  readDelta: 6.2,
  failedDelta: -18.5,
  clickThroughRateDelta: 3.1,
};

const FUNNEL: readonly FunnelStage[] = [
  { label: 'Sent', value: TOTAL_SENT },
  { label: 'Delivered', value: TOTAL_DELIVERED },
  { label: 'Read', value: TOTAL_READ },
  { label: 'Clicked', value: TOTAL_CLICKED },
];

const ACTIVITY_SEED: readonly { actor: string; action: string; subject: string; hours: number }[] = [
  { actor: 'Amara Chen', action: 'launched campaign', subject: 'Loyalty Points Reminder', hours: 2 },
  { actor: 'Diego Rivera', action: 'imported', subject: '1,204 contacts from CSV', hours: 5 },
  { actor: 'Sofia Moreau', action: 'created template', subject: 'loyalty_points_update', hours: 9 },
  { actor: 'Amara Chen', action: 'scheduled', subject: 'August Restock Announcement', hours: 26 },
  { actor: 'Diego Rivera', action: 'added tag', subject: 'Churn risk to 87 contacts', hours: 31 },
  { actor: 'Sofia Moreau', action: 'paused campaign', subject: 'Feedback Push — Q2', hours: 48 },
  { actor: 'Amara Chen', action: 'synced templates', subject: 'from Meta Business Manager', hours: 54 },
  { actor: 'Diego Rivera', action: 'exported report', subject: 'Cart Recovery — July', hours: 72 },
];

const ACTIVITY: readonly ActivityEntry[] = ACTIVITY_SEED.map((seed, index) => ({
  id: `act_${index + 1}`,
  actor: seed.actor,
  actorInitials: initialsOf(seed.actor),
  action: seed.action,
  subject: seed.subject,
  occurredAt: daysAgo(0, seed.hours),
}));

export const DASHBOARD: DashboardSnapshot = {
  kpis: KPIS,
  trend: TREND,
  funnel: FUNNEL,
  activity: ACTIVITY,
};

/* ------------------------------------------------------------------ *
 * Platform administration
 * ------------------------------------------------------------------ */
const TENANT_NAMES = [
  'Northwind Retail', 'Lumen Health', 'Fable Books', 'Orbit Logistics', 'Verde Grocers',
  'Atlas Fitness', 'Kite Travel', 'Harbour Bank', 'Solace Spa', 'Pioneer Motors',
  'Bloom Florists', 'Summit Outdoors',
];

const PLANS: readonly TenantPlan[] = ['starter', 'growth', 'scale', 'enterprise'];
const TENANT_STATUSES: readonly TenantStatus[] = [
  'active', 'active', 'active', 'active', 'trialing', 'suspended',
];

export const TENANTS: readonly Tenant[] = TENANT_NAMES.map((name, index) => {
  const plan = pick(PLANS);
  const quota = plan === 'starter' ? 25000 : plan === 'growth' ? 150000 : plan === 'scale' ? 600000 : 2000000;

  return {
    id: `tnt_${(index + 1).toString().padStart(3, '0')}`,
    name,
    ownerEmail: `owner@${name.toLowerCase().replace(/[^a-z]/g, '')}.com`,
    plan,
    status: index === 0 ? 'active' : pick(TENANT_STATUSES),
    seats: between(3, 64),
    messagesThisMonth: Math.floor(quota * (0.18 + random() * 0.74)),
    messageQuota: quota,
    createdAt: daysAgo(between(30, 900)),
  };
});

const AUDIT_ACTIONS: readonly { action: string; target: string; severity: AuditSeverity }[] = [
  { action: 'signed in', target: 'web session', severity: 'info' },
  { action: 'updated role for', target: 'diego@northwind.com', severity: 'warning' },
  { action: 'deleted', target: '312 contacts', severity: 'critical' },
  { action: 'connected', target: 'WhatsApp Business number', severity: 'warning' },
  { action: 'exported', target: 'contacts.csv', severity: 'warning' },
  { action: 'created', target: 'campaign Summer Sale — Early Access', severity: 'info' },
  { action: 'rotated', target: 'API credentials', severity: 'critical' },
  { action: 'changed plan to', target: 'Scale', severity: 'info' },
  { action: 'suspended workspace', target: 'Solace Spa', severity: 'critical' },
  { action: 'invited', target: 'sofia@northwind.com', severity: 'info' },
];

const AUDIT_ACTORS = ['Priya Raman', 'Amara Chen', 'Diego Rivera', 'Sofia Moreau', 'System'];

export const AUDIT_LOGS: readonly AuditLogEntry[] = Array.from({ length: 34 }, (_, index) => {
  const entry = pick(AUDIT_ACTIONS);
  const actor = pick(AUDIT_ACTORS);

  return {
    id: `aud_${(index + 1).toString().padStart(3, '0')}`,
    actor,
    actorInitials: actor === 'System' ? 'SY' : initialsOf(actor),
    action: entry.action,
    target: entry.target,
    workspace: pick(TENANT_NAMES),
    ipAddress: `${between(20, 210)}.${between(0, 255)}.${between(0, 255)}.${between(1, 254)}`,
    severity: entry.severity,
    occurredAt: daysAgo(between(0, 14), between(0, 23)),
  };
});

export const SYSTEM: SystemSnapshot = {
  services: [
    { name: 'Web API', status: 'operational', uptimePercent: 99.98, latencyMs: 84 },
    { name: 'Message dispatcher', status: 'operational', uptimePercent: 99.95, latencyMs: 142 },
    { name: 'Meta Cloud API bridge', status: 'degraded', uptimePercent: 99.21, latencyMs: 610 },
    { name: 'Webhook receiver', status: 'operational', uptimePercent: 99.99, latencyMs: 47 },
    { name: 'Report generator', status: 'operational', uptimePercent: 99.87, latencyMs: 318 },
  ],
  quotas: [
    { label: 'Messages this month', used: 3_842_100, limit: 5_000_000, unit: 'messages' },
    { label: 'Active workspaces', used: 12, limit: 25, unit: 'workspaces' },
    { label: 'Storage', used: 412, limit: 1024, unit: 'GB' },
    { label: 'Webhook throughput', used: 1840, limit: 3000, unit: 'req/min' },
  ],
  throughput: Array.from({ length: 24 }, (_, hour) => ({
    label: `${hour.toString().padStart(2, '0')}:00`,
    // Traffic tracks waking hours rather than being uniformly random.
    value: Math.floor(400 + Math.sin((hour / 24) * Math.PI * 2 - 1.6) * 260 + random() * 120 + 300),
  })),
};
