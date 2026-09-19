import type { ConnectionStatus, MessagingTier, QualityRating } from './whatsapp.model';

/**
 * Multiple WhatsApp numbers per workspace.
 *
 * A workspace holds as many numbers as its plan allows. An Admin decides, per
 * employee and per number, who may **view**, **reply** and **broadcast**. The
 * global permissions (`whatsapp.inbox.reply`, …) still apply on top: both layers
 * must allow an action. See `docs/API-MULTI-WHATSAPP-BACKEND.md`.
 */

export type WhatsAppAccessPermission = 'view' | 'reply' | 'broadcast';

export const WHATSAPP_ACCESS_PERMISSIONS: readonly WhatsAppAccessPermission[] = [
  'view',
  'reply',
  'broadcast',
];

export const WHATSAPP_ACCESS_COPY: Readonly<
  Record<WhatsAppAccessPermission, { readonly label: string; readonly description: string }>
> = {
  view: { label: 'View', description: 'Read conversations and templates on this number.' },
  reply: { label: 'Reply', description: "Answer customers and assign conversations." },
  broadcast: { label: 'Broadcast', description: 'Create and send campaigns from this number.' },
};

export interface WhatsAppAccountHealth {
  /** Outcome of the most recent Graph API call made for this account. */
  readonly apiStatus: 'ok' | 'degraded' | 'down' | 'unknown';
  /** Meta's phone number status, passed through (`CONNECTED`, `FLAGGED`, …). */
  readonly phoneNumberStatus: string | null;
  /** WABA review status, passed through (`APPROVED`, `PENDING`, …). */
  readonly accountStatus: string | null;
  readonly lastWebhookAt: string | null;
  readonly lastMessageSentAt: string | null;
  readonly lastMessageReceivedAt: string | null;
  /** Plain language. Never a raw Meta error body or token. */
  readonly lastError: string | null;
}

export interface WhatsAppAccount {
  readonly id: string;
  /** Admin-chosen name, e.g. "Sales". Unique per workspace. */
  readonly label: string;
  readonly displayPhoneNumber: string;
  readonly verifiedName: string;
  /** Templates belong to a WABA, and two numbers may share one. */
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly status: ConnectionStatus;
  readonly qualityRating: QualityRating;
  readonly messagingTier: MessagingTier;
  readonly messagingLimit: number;
  readonly messagesLast24h: number;
  /** `null` = no stated expiry (system-user token), **not** expired. */
  readonly tokenExpiresAt: string | null;
  readonly connectedAt: string | null;
  /** Exactly one account is the workspace default whenever any exist. */
  readonly isDefault: boolean;
  /** What the **signed-in user** may do on this number. Admins get all three. */
  readonly myPermissions: readonly WhatsAppAccessPermission[];
  readonly health: WhatsAppAccountHealth;
}

export interface WhatsAppAccountList {
  /** Only the accounts the caller may view. */
  readonly items: readonly WhatsAppAccount[];
  /** The plan's `maxWhatsAppAccounts`; `null` = unlimited. */
  readonly limit: number | null;
  /** Accounts in the whole workspace counting against the limit. */
  readonly used: number;
  /** The caller's own default: employee default, else the workspace default. */
  readonly myDefaultAccountId: string | null;
}

/** One row of an employee's access. */
export interface WhatsAppAccess {
  readonly accountId: string;
  readonly permissions: readonly WhatsAppAccessPermission[];
}

export interface WhatsAppAccessUpdate {
  readonly access: readonly WhatsAppAccess[];
  readonly defaultAccountId: string | null;
}

/* ------------------------------------------------------------------ *
 * Access rules
 * ------------------------------------------------------------------ */

/**
 * Applies one checkbox change and keeps the set coherent.
 *
 * Reply and broadcast are meaningless without view, so ticking either ticks
 * view, and unticking view clears the others. The API rejects an incoherent
 * set rather than repairing it, so the editor must never be able to produce one.
 */
export function toggleAccessPermission(
  current: readonly WhatsAppAccessPermission[],
  permission: WhatsAppAccessPermission,
  enabled: boolean,
): readonly WhatsAppAccessPermission[] {
  const next = new Set(current);

  if (enabled) {
    next.add(permission);
    next.add('view');
  } else if (permission === 'view') {
    next.clear();
  } else {
    next.delete(permission);
  }

  // Stable order, so two equal sets compare equal and the payload reads naturally.
  return WHATSAPP_ACCESS_PERMISSIONS.filter((entry) => next.has(entry));
}

/** Client mirror of the API's validation for `PUT /employees/{id}/whatsapp-access`. */
export function accessProblems(update: WhatsAppAccessUpdate): readonly string[] {
  const problems: string[] = [];
  const ids = update.access.map((row) => row.accountId);

  if (new Set(ids).size !== ids.length) {
    problems.push('A number appears more than once.');
  }
  for (const row of update.access) {
    if (row.permissions.length === 0) {
      problems.push('Every assigned number needs at least View.');
      break;
    }
    if (!row.permissions.includes('view')) {
      problems.push('Reply and Broadcast need View on the same number.');
      break;
    }
  }
  if (update.defaultAccountId !== null && !ids.includes(update.defaultAccountId)) {
    problems.push('The default number must be one this person has access to.');
  }

  return problems;
}

export function can(account: WhatsAppAccount, permission: WhatsAppAccessPermission): boolean {
  return account.myPermissions.includes(permission);
}

export function atAccountLimit(list: WhatsAppAccountList): boolean {
  return list.limit !== null && list.used >= list.limit;
}

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */

export type AccountHealthLevel = 'healthy' | 'attention' | 'down';

export interface AccountHealthVerdict {
  readonly level: AccountHealthLevel;
  /** Why, in order of importance. Empty when healthy. */
  readonly reasons: readonly string[];
}

const DAY_MS = 86_400_000;
const TOKEN_WARNING_MS = 7 * DAY_MS;
const WEBHOOK_SILENCE_MS = DAY_MS;

/**
 * The traffic light for one number.
 *
 * Every reason is collected, not just the first, because troubleshooting needs
 * the whole list — but the level is the worst one found.
 *
 * "No webhook for a day" is the signal that matters most and is easiest to
 * miss: it is the only sign that Meta has stopped delivering, and nothing else
 * on the screen would show it.
 */
export function accountHealth(account: WhatsAppAccount, now = Date.now()): AccountHealthVerdict {
  const down: string[] = [];
  const attention: string[] = [];
  const { health } = account;

  if (account.status === 'disconnected') {
    down.push('Disconnected');
  } else if (account.status === 'error') {
    down.push(health.lastError ?? 'Connection error');
  } else if (account.status === 'pending') {
    attention.push('Setup still in progress');
  }

  if (health.apiStatus === 'down') {
    down.push('Meta API unreachable');
  } else if (health.apiStatus === 'degraded') {
    attention.push('Meta API responding slowly or with errors');
  }

  if (account.tokenExpiresAt !== null) {
    const remaining = new Date(account.tokenExpiresAt).getTime() - now;
    if (remaining <= 0) {
      down.push('Access token expired');
    } else if (remaining < TOKEN_WARNING_MS) {
      const days = Math.max(1, Math.ceil(remaining / DAY_MS));
      attention.push(`Access token expires in ${days} day${days === 1 ? '' : 's'}`);
    }
  }

  if (account.qualityRating === 'red') {
    down.push('Quality rating is low');
  } else if (account.qualityRating === 'yellow') {
    attention.push('Quality rating is medium');
  }

  const phoneStatus = health.phoneNumberStatus?.toUpperCase() ?? null;
  if (phoneStatus === 'FLAGGED' || phoneStatus === 'RESTRICTED') {
    attention.push(`Number ${phoneStatus.toLowerCase()} by Meta`);
  }

  if (account.status === 'connected') {
    const lastWebhook = health.lastWebhookAt === null ? null : new Date(health.lastWebhookAt).getTime();
    if (lastWebhook === null || now - lastWebhook > WEBHOOK_SILENCE_MS) {
      attention.push('No webhook received in 24 hours');
    }
  }

  if (down.length > 0) {
    return { level: 'down', reasons: [...down, ...attention] };
  }
  if (attention.length > 0) {
    return { level: 'attention', reasons: attention };
  }
  return { level: 'healthy', reasons: [] };
}

export const HEALTH_LABEL: Readonly<Record<AccountHealthLevel, string>> = {
  healthy: 'Healthy',
  attention: 'Needs attention',
  down: 'Down',
};

/** `Sales · +92 300 1234567` — how a number is named anywhere space allows. */
export function accountDisplayName(account: Pick<WhatsAppAccount, 'label' | 'displayPhoneNumber'>): string {
  return `${account.label} · ${account.displayPhoneNumber}`;
}
