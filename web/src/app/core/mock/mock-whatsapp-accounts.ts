import type { HttpEvent } from '@angular/common/http';
import type { Observable } from 'rxjs';

import type { Employee } from '@core/models/employee.model';
import {
  WHATSAPP_ACCESS_PERMISSIONS,
  accessProblems,
  type WhatsAppAccess,
  type WhatsAppAccessPermission,
  type WhatsAppAccessUpdate,
  type WhatsAppAccount,
  type WhatsAppAccountList,
} from '@core/models/whatsapp-account.model';

interface MockHelpers {
  readonly ok: (data: unknown, message?: string | null) => Observable<HttpEvent<unknown>>;
  readonly fail: (status: number, title: string, detail: string, errorCode?: string) => Observable<never>;
  readonly failValidation: (errors: Readonly<Record<string, readonly string[]>>) => Observable<never>;
}

/** Who is asking, as far as per-number access is concerned. */
export interface MockWhatsAppActor {
  readonly userId: string;
  readonly isAdmin: boolean;
}

/** Stands in for the plan's `maxWhatsAppAccounts`. */
export const MOCK_WHATSAPP_ACCOUNT_LIMIT = 5;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number): string => new Date(Date.now() + ms).toISOString();

/**
 * Three numbers, one per health state, so the dashboard and the WhatsApp page
 * show every traffic light without anyone breaking a real connection.
 */
const whatsAppAccountStore: Omit<WhatsAppAccount, 'myPermissions'>[] = [
  {
    id: 'wa_sales',
    label: 'Sales',
    displayPhoneNumber: '+92 300 1234567',
    verifiedName: 'Northwind Retail',
    wabaId: 'waba_1',
    phoneNumberId: 'pn_1',
    status: 'connected',
    qualityRating: 'green',
    messagingTier: 'tier_10k',
    messagingLimit: 10_000,
    messagesLast24h: 1_842,
    tokenExpiresAt: null,
    connectedAt: ago(90 * DAY),
    isDefault: true,
    health: {
      apiStatus: 'ok',
      phoneNumberStatus: 'CONNECTED',
      accountStatus: 'APPROVED',
      lastWebhookAt: ago(4 * 60_000),
      lastMessageSentAt: ago(9 * 60_000),
      lastMessageReceivedAt: ago(4 * 60_000),
      lastError: null,
    },
  },
  {
    id: 'wa_support',
    label: 'Support',
    displayPhoneNumber: '+92 321 7654321',
    verifiedName: 'Northwind Retail',
    wabaId: 'waba_1',
    phoneNumberId: 'pn_2',
    status: 'connected',
    qualityRating: 'green',
    messagingTier: 'tier_1k',
    messagingLimit: 1_000,
    messagesLast24h: 212,
    // Inside the seven-day warning, so this number shows amber.
    tokenExpiresAt: ahead(3 * DAY),
    connectedAt: ago(40 * DAY),
    isDefault: false,
    health: {
      apiStatus: 'ok',
      phoneNumberStatus: 'CONNECTED',
      accountStatus: 'APPROVED',
      lastWebhookAt: ago(35 * 60_000),
      lastMessageSentAt: ago(2 * HOUR),
      lastMessageReceivedAt: ago(35 * 60_000),
      lastError: null,
    },
  },
  {
    id: 'wa_marketing',
    label: 'Marketing',
    displayPhoneNumber: '+92 333 5550199',
    verifiedName: 'Northwind Retail',
    wabaId: 'waba_2',
    phoneNumberId: 'pn_3',
    status: 'disconnected',
    qualityRating: 'yellow',
    messagingTier: 'tier_250',
    messagingLimit: 250,
    messagesLast24h: 0,
    tokenExpiresAt: null,
    connectedAt: null,
    isDefault: false,
    health: {
      apiStatus: 'down',
      phoneNumberStatus: 'PENDING',
      accountStatus: 'APPROVED',
      lastWebhookAt: ago(6 * DAY),
      lastMessageSentAt: ago(6 * DAY),
      lastMessageReceivedAt: ago(7 * DAY),
      lastError: 'The access token was revoked in Meta Business Manager.',
    },
  },
];

/** Per-employee access, keyed by user id. Admins are never stored: they have everything. */
const employeeAccessStore = new Map<string, WhatsAppAccessUpdate>([
  [
    'usr_employee',
    {
      access: [
        { accountId: 'wa_sales', permissions: ['view', 'reply'] },
        { accountId: 'wa_support', permissions: ['view', 'reply', 'broadcast'] },
      ],
      defaultAccountId: 'wa_support',
    },
  ],
]);

function permissionsFor(actor: MockWhatsAppActor, accountId: string): readonly WhatsAppAccessPermission[] {
  if (actor.isAdmin) {
    return WHATSAPP_ACCESS_PERMISSIONS;
  }
  const row = employeeAccessStore.get(actor.userId)?.access.find((entry) => entry.accountId === accountId);
  return row?.permissions ?? [];
}

function visibleTo(actor: MockWhatsAppActor): WhatsAppAccount[] {
  return whatsAppAccountStore
    .map((account) => ({ ...account, myPermissions: permissionsFor(actor, account.id) }))
    .filter((account) => account.myPermissions.includes('view'));
}

/** Labels, for denormalising onto conversations and campaigns. */
export function accountLabel(id: string): string {
  return whatsAppAccountStore.find((account) => account.id === id)?.label ?? 'Unknown number';
}

export function canOnMockAccount(
  actor: MockWhatsAppActor,
  accountId: string,
  permission: WhatsAppAccessPermission,
): boolean {
  return permissionsFor(actor, accountId).includes(permission);
}

export function mockAccountLimitReached(): boolean {
  return whatsAppAccountStore.length >= MOCK_WHATSAPP_ACCOUNT_LIMIT;
}

/** Adds the access fields the API will return on every employee. */
export function withWhatsAppAccess(employee: Employee): Employee {
  if (employee.role !== 'Employee') {
    return { ...employee, whatsAppAccess: [], defaultWhatsAppAccountId: null };
  }
  const stored = employeeAccessStore.get(employee.id);
  return {
    ...employee,
    whatsAppAccess: stored?.access ?? [],
    defaultWhatsAppAccountId: stored?.defaultAccountId ?? null,
  };
}

/** Stores access sent with an invitation. */
export function storeInvitedAccess(employeeId: string, update: WhatsAppAccessUpdate): void {
  employeeAccessStore.set(employeeId, update);
}

function listFor(actor: MockWhatsAppActor): WhatsAppAccountList {
  const items = visibleTo(actor);
  const own = employeeAccessStore.get(actor.userId)?.defaultAccountId ?? null;
  return {
    items,
    limit: MOCK_WHATSAPP_ACCOUNT_LIMIT,
    used: whatsAppAccountStore.length,
    myDefaultAccountId:
      (own !== null && items.some((account) => account.id === own) ? own : null) ??
      items.find((account) => account.isDefault)?.id ??
      null,
  };
}

/**
 * `/whatsapp/accounts` and `/employees/{id}/whatsapp-access`, following
 * `docs/API-MULTI-WHATSAPP-BACKEND.md` including its refusals — so the screens
 * are exercised against the rules, not just the happy path.
 */
export function handleWhatsAppAccounts(
  path: string,
  method: string,
  body: unknown,
  actor: MockWhatsAppActor | null,
  findEmployee: (id: string) => Employee | undefined,
  { ok, fail, failValidation }: MockHelpers,
): Observable<HttpEvent<unknown>> | null {
  const accessMatch = /^\/employees\/([^/]+)\/whatsapp-access$/.exec(path);
  const accountsMatch = /^\/whatsapp\/accounts(?:\/([^/]+))?(?:\/(default|sync|disconnect))?$/.exec(path);

  if (accessMatch === null && accountsMatch === null) {
    return null;
  }
  if (actor === null) {
    return fail(401, 'Session expired', 'Please sign in again.');
  }

  /* ------------------------- employee access ------------------------- */

  if (accessMatch !== null) {
    if (method !== 'PUT') {
      return null;
    }
    if (!actor.isAdmin) {
      return fail(403, 'Not permitted', 'Only an administrator can change who works on which number.', 'forbidden');
    }
    const employee = findEmployee(accessMatch[1]);
    if (employee === undefined) {
      return fail(404, 'Not found', 'That employee no longer exists.');
    }
    if (employee.role !== 'Employee') {
      return fail(
        409,
        'Administrators have every number',
        'Administrators always have full access to every WhatsApp number, so there is nothing to assign.',
        'role_derived_permissions',
      );
    }

    const update = (body ?? {}) as WhatsAppAccessUpdate;
    const access: readonly WhatsAppAccess[] = update.access ?? [];
    const unknown = access.find((row) => !whatsAppAccountStore.some((account) => account.id === row.accountId));
    const problems = [
      ...accessProblems({ access, defaultAccountId: update.defaultAccountId ?? null }),
      ...(unknown === undefined ? [] : ['One of those numbers no longer exists.']),
    ];
    if (problems.length > 0) {
      return failValidation({ access: problems });
    }

    employeeAccessStore.set(employee.id, { access, defaultAccountId: update.defaultAccountId ?? null });
    return ok(withWhatsAppAccess(employee), 'WhatsApp access updated.');
  }

  /* ----------------------------- accounts ----------------------------- */

  const [, rawId, action] = accountsMatch!;

  if (rawId === undefined) {
    return method === 'GET' ? ok(listFor(actor)) : null;
  }

  const index = whatsAppAccountStore.findIndex((account) => account.id === rawId);
  // 404, not 403, for a number the caller may not see: its existence is not theirs to learn.
  if (index === -1 || !permissionsFor(actor, rawId).includes('view')) {
    return fail(404, 'Not found', 'That WhatsApp number does not exist.', 'whatsapp_account_not_found');
  }
  const current = whatsAppAccountStore[index];
  const present = (): WhatsAppAccount => ({
    ...whatsAppAccountStore[index],
    myPermissions: permissionsFor(actor, rawId),
  });

  if (action === undefined && method === 'GET') {
    return ok(present());
  }

  // Everything below changes the number, which is an administrator's job.
  if (!actor.isAdmin) {
    return fail(403, 'Not permitted', 'Only an administrator can manage WhatsApp numbers.', 'forbidden');
  }

  if (action === undefined && method === 'PATCH') {
    const label = ((body ?? {}) as { label?: string }).label?.trim() ?? '';
    if (label === '' || label.length > 40) {
      return failValidation({ label: ['A name is required, up to 40 characters.'] });
    }
    const taken = whatsAppAccountStore.some(
      (account, position) => position !== index && account.label.toLowerCase() === label.toLowerCase(),
    );
    if (taken) {
      return fail(409, 'Name already used', `Another number is already called "${label}".`, 'whatsapp_label_taken');
    }
    whatsAppAccountStore[index] = { ...current, label };
    return ok(present(), 'Number renamed.');
  }

  if (action === undefined && method === 'DELETE') {
    if (current.status !== 'disconnected') {
      return fail(
        409,
        'Disconnect it first',
        `${current.label} is still connected. Disconnect it before removing it.`,
        'whatsapp_account_connected',
      );
    }
    whatsAppAccountStore.splice(index, 1);
    for (const [employeeId, stored] of employeeAccessStore) {
      employeeAccessStore.set(employeeId, {
        access: stored.access.filter((row) => row.accountId !== rawId),
        defaultAccountId: stored.defaultAccountId === rawId ? null : stored.defaultAccountId,
      });
    }
    return ok(null, 'Number removed.');
  }

  if (method !== 'POST') {
    return null;
  }

  if (action === 'default') {
    if (current.status !== 'connected') {
      return fail(
        409,
        'Not connected',
        `${current.label} is not connected, so it cannot be the default number.`,
        'whatsapp_account_not_connected',
      );
    }
    for (let position = 0; position < whatsAppAccountStore.length; position++) {
      whatsAppAccountStore[position] = { ...whatsAppAccountStore[position], isDefault: position === index };
    }
    return ok(visibleTo(actor), `${current.label} is now the default number.`);
  }

  if (action === 'sync') {
    whatsAppAccountStore[index] = {
      ...current,
      health: { ...current.health, apiStatus: current.status === 'connected' ? 'ok' : 'down' },
    };
    return ok(present(), 'Refreshed from Meta.');
  }

  // disconnect
  const wasDefault = current.isDefault;
  whatsAppAccountStore[index] = {
    ...current,
    status: 'disconnected',
    isDefault: false,
    health: { ...current.health, apiStatus: 'down', lastError: 'Disconnected by an administrator.' },
  };
  if (wasDefault) {
    const next = whatsAppAccountStore.findIndex((account) => account.status === 'connected');
    if (next !== -1) {
      whatsAppAccountStore[next] = { ...whatsAppAccountStore[next], isDefault: true };
    }
  }
  return ok(present(), `${current.label} disconnected.`);
}
