import type { IconName } from '@shared/ui/icon/icon.registry';

/**
 * What a notification is *about*, for grouping the list and for the switches in
 * Settings.
 *
 * Worked out from the kind's prefix rather than a list of every kind, so a kind
 * this build has never seen still lands somewhere sensible — `campaign.paused`
 * would group with campaigns without anyone touching this file. Anything
 * unrecognised falls into `system`, which is never silenced, so a new backend
 * feature can't be swallowed by a switch nobody knew applied to it.
 */
export const NOTIFICATION_CATEGORIES = ['messages', 'campaigns', 'team', 'billing', 'security', 'system'] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationCategoryCopy {
  readonly label: string;
  /** What arrives in this group, in the user's terms. */
  readonly description: string;
  readonly icon: IconName;
  /**
   * Cannot be switched off. Security and account warnings are the ones you most
   * need when you are not expecting them — a stolen login or a failed payment
   * silenced by a switch set months ago is exactly the kind of quiet failure
   * this product should never have.
   */
  readonly alwaysOn?: boolean;
}

export const NOTIFICATION_CATEGORY_COPY: Readonly<Record<NotificationCategory, NotificationCategoryCopy>> = {
  messages: {
    label: 'Messages',
    description: 'A customer replies in the inbox, or a conversation is assigned to you.',
    icon: 'chat',
  },
  campaigns: {
    label: 'Campaigns',
    description: 'A campaign finishes, fails or is paused.',
    icon: 'megaphone',
  },
  team: {
    label: 'Your team',
    description: 'Invitations, and changes to who can do what.',
    icon: 'userGroup',
  },
  billing: {
    label: 'Billing and plan',
    description: 'Payments, renewals, plan changes and usage limits.',
    icon: 'creditCard',
  },
  security: {
    label: 'Security',
    description: 'New sign-ins, shared-login warnings and suspended accounts.',
    icon: 'lock',
    alwaysOn: true,
  },
  system: {
    label: 'System',
    description: 'WhatsApp connection problems, expiring access and anything else that needs attention.',
    icon: 'shield',
    alwaysOn: true,
  },
};

/** Kind prefixes, longest first so `whatsapp.token` beats `whatsapp`. */
const CATEGORY_BY_PREFIX: readonly (readonly [string, NotificationCategory])[] = [
  ['inbox', 'messages'],
  ['conversation', 'messages'],
  ['campaign', 'campaigns'],
  ['employee', 'team'],
  ['permission', 'team'],
  ['payment', 'billing'],
  ['subscription', 'billing'],
  ['plan', 'billing'],
  ['invoice', 'billing'],
  ['storage', 'billing'],
  ['contacts', 'billing'],
  ['messages', 'billing'],
  ['security', 'security'],
  ['session', 'security'],
];

export function categoryOf(kind: string): NotificationCategory {
  const prefix = kind.split('.')[0]?.toLowerCase() ?? '';
  return CATEGORY_BY_PREFIX.find(([name]) => name === prefix)?.[1] ?? 'system';
}

/** A category name from the wire, or null when it is absent or unknown. */
export function toCategory(value: unknown): NotificationCategory | null {
  const text = String(value ?? '').toLowerCase();
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(text)
    ? (text as NotificationCategory)
    : null;
}

/**
 * Which group a notification belongs to.
 *
 * **The server's own answer wins.** It decides the category when the
 * notification is raised, uses it to honour the user's switches, and sends it on
 * the payload — so trusting the prefix instead would risk the list disagreeing
 * with what was actually filtered. The prefix rule stays as the fallback, for
 * an API that predates the field.
 */
export function categoryOfNotification(notification: {
  readonly category?: NotificationCategory | string | null;
  readonly kind: string;
}): NotificationCategory {
  return toCategory(notification.category) ?? categoryOf(notification.kind);
}

export function isAlwaysOn(category: NotificationCategory): boolean {
  return NOTIFICATION_CATEGORY_COPY[category].alwaysOn === true;
}

/** The categories a user can actually switch off, in the order Settings lists them. */
export const SWITCHABLE_CATEGORIES: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES.filter(
  (category) => !isAlwaysOn(category),
);

/** What each category is set to. Absent from an older API, which means "everything on". */
export type NotificationPreferences = Readonly<Record<NotificationCategory, boolean>>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  messages: true,
  campaigns: true,
  team: true,
  billing: true,
  security: true,
  system: true,
};

/**
 * Normalises what the server sends: unknown keys are dropped, missing ones
 * default to on, and the always-on categories are forced on whatever arrives —
 * a stale stored `false` must not silence a security warning.
 */
export function toPreferences(raw: Partial<Record<string, unknown>> | null | undefined): NotificationPreferences {
  const result: Record<NotificationCategory, boolean> = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const category of NOTIFICATION_CATEGORIES) {
    const value = raw?.[category];
    result[category] = isAlwaysOn(category) ? true : typeof value === 'boolean' ? value : true;
  }
  return result;
}
