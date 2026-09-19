import type { HttpEvent } from '@angular/common/http';
import type { Observable } from 'rxjs';

import type {
  DeviceSession,
  SecurityEmployee,
  SecurityOverview,
} from '@core/models/session-security.model';

interface MockHelpers {
  readonly ok: (data: unknown, message?: string | null) => Observable<HttpEvent<unknown>>;
  readonly fail: (status: number, title: string, detail: string, errorCode?: string) => Observable<never>;
}

export interface MockSecurityActor {
  readonly userId: string;
  readonly role: 'SuperAdmin' | 'Admin' | 'Employee';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

function device(
  sessionId: string,
  label: string,
  overrides: Partial<DeviceSession> = {},
): DeviceSession {
  const [browser, operatingSystem] = label.split(' / ');
  return {
    sessionId,
    deviceLabel: label,
    browser: browser ?? label,
    operatingSystem: operatingSystem ?? '',
    deviceType: /iOS|Android/.test(label) ? 'mobile' : 'desktop',
    ipAddress: '39.45.12.8',
    location: 'Lahore, PK',
    firstSeenAt: ago(20 * DAY),
    lastActiveAt: ago(2 * DAY),
    isActive: false,
    isCurrent: false,
    canRevoke: true,
    signIns: 2,
    ...overrides,
  };
}

/** Everyone's devices, keyed by user id. */
const devicesByUser = new Map<string, DeviceSession[]>([
  [
    'usr_admin',
    [
      device('ses_admin_1', 'Chrome / Windows', { isCurrent: true, isActive: true, lastActiveAt: ago(MINUTE), signIns: 14 }),
      device('ses_admin_2', 'Safari / iOS', { lastActiveAt: ago(3 * DAY), location: 'Karachi, PK', ipAddress: '111.68.9.20' }),
    ],
  ],
  [
    // The shared-login pattern: many devices, several cities, pushed off repeatedly.
    'usr_employee',
    [
      device('ses_emp_1', 'Chrome / Windows', { isActive: true, lastActiveAt: ago(2 * MINUTE), signIns: 9 }),
      device('ses_emp_2', 'Edge / Windows', { lastActiveAt: ago(40 * MINUTE), location: 'Islamabad, PK', ipAddress: '182.176.3.4' }),
      device('ses_emp_3', 'Chrome / Android', { lastActiveAt: ago(3 * HOUR), location: 'Islamabad, PK', ipAddress: '182.176.3.4' }),
      device('ses_emp_4', 'Firefox / Linux', { lastActiveAt: ago(20 * HOUR), location: null, ipAddress: '10.0.0.7', firstSeenAt: ago(20 * HOUR) }),
    ],
  ],
  ['usr_sara', [device('ses_sara_1', 'Chrome / macOS', { lastActiveAt: ago(5 * HOUR), signIns: 3 })]],
]);

const PEOPLE: readonly Omit<SecurityEmployee, 'activeSessions' | 'devices' | 'lastActiveAt' | 'risk'>[] = [
  { userId: 'usr_admin', name: 'Admin User', email: 'admin@nextreach.io', role: 'Admin', displacedLast24Hours: 0 },
  { userId: 'usr_employee', name: 'Employee User', email: 'employee@nextreach.io', role: 'Employee', displacedLast24Hours: 4 },
  { userId: 'usr_sara', name: 'Sara Khan', email: 'sara@nextreach.io', role: 'Employee', displacedLast24Hours: 2 },
];

/** Suspended accounts, by user id. */
const suspendedIds = new Set<string>();

/** For the mock sign-in: the API refuses a suspended account after a correct password. */
export function isMockAccountSuspended(email: string): boolean {
  const person = PEOPLE.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
  return person !== undefined && suspendedIds.has(person.userId);
}

function employeeRow(person: (typeof PEOPLE)[number], withRisk: boolean): SecurityEmployee {
  const devices = devicesByUser.get(person.userId) ?? [];
  const risky = person.displacedLast24Hours >= 3;
  const warning = !risky && person.displacedLast24Hours > 0;
  return {
    ...person,
    status: suspendedIds.has(person.userId) ? 'suspended' : 'active',
    activeSessions: devices.filter((entry) => entry.isActive).length,
    devices: devices.length,
    lastActiveAt: devices.map((entry) => entry.lastActiveAt).sort().at(-1) ?? null,
    risk: !withRisk
      ? null
      : risky
        ? {
            level: 'high',
            score: 80,
            reasons: [
              `${person.displacedLast24Hours} sign-ins pushed another session off in 24 hours`,
              `${devices.length} devices in 30 days`,
              '2 locations in 7 days',
              'New device in the last 24 hours',
            ],
          }
        : warning
          ? {
              level: 'medium',
              score: 45,
              reasons: [`${person.displacedLast24Hours} sign-ins pushed another session off in 24 hours`, 'New device in the last 24 hours'],
            }
          : { level: 'low', score: 5, reasons: [] },
  };
}

function overview(withRisk: boolean, tenantId: string | null = null): SecurityOverview {
  // Only some workspaces show a shared login, so the platform list has variety.
  const calm = tenantId !== null && !/[13579]$/.test(tenantId);
  const employees = PEOPLE.map((person) =>
    employeeRow(calm ? { ...person, displacedLast24Hours: 0 } : person, withRisk),
  );
  return {
    organizationId: 'tnt_7',
    organizationName: 'Northwind Retail',
    planName: 'Professional',
    purchasedSeats: 5,
    usedSeats: employees.length,
    activeSessions: employees.reduce((sum, entry) => sum + entry.activeSessions, 0),
    uniqueDevices: employees.reduce((sum, entry) => sum + entry.devices, 0),
    deviceWindowDays: 30,
    employees,
  };
}

function revoke(sessionId: string): boolean {
  for (const [userId, devices] of devicesByUser) {
    if (devices.some((entry) => entry.sessionId === sessionId)) {
      devicesByUser.set(userId, devices.filter((entry) => entry.sessionId !== sessionId));
      return true;
    }
  }
  return false;
}

/**
 * Session security, following the backend notes: the workspace view never
 * carries a risk score, the platform view always does, and nobody can revoke
 * the session they are using from a device list.
 */
export function handleSessionSecurity(
  path: string,
  method: string,
  actor: MockSecurityActor | null,
  { ok, fail }: MockHelpers,
): Observable<HttpEvent<unknown>> | null {
  const isSecurityPath =
    path === '/auth/heartbeat' ||
    path.startsWith('/auth/sessions') ||
    path.startsWith('/security') ||
    path.startsWith('/superadmin/security');
  if (!isSecurityPath) {
    return null;
  }
  if (actor === null) {
    return fail(401, 'Session expired', 'Please sign in again.');
  }

  if (method === 'POST' && path === '/auth/heartbeat') {
    return ok(null);
  }

  /* ------------------------------ my devices ------------------------------ */

  if (method === 'GET' && path === '/auth/sessions') {
    const mine = devicesByUser.get(actor.userId) ?? [device('ses_self', 'Chrome / Windows', { isActive: true })];
    // The current device first, as the API returns it.
    return ok(
      [...mine]
        .map((entry, index) => ({ ...entry, isCurrent: index === 0, canRevoke: index !== 0 }))
        .sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent)),
    );
  }

  const myRevoke = /^\/auth\/sessions\/([^/]+)\/revoke$/.exec(path);
  if (method === 'POST' && myRevoke !== null) {
    const mine = devicesByUser.get(actor.userId) ?? [];
    if (!mine.some((entry) => entry.sessionId === myRevoke[1])) {
      return fail(404, 'Not found', 'That device is no longer signed in.');
    }
    revoke(myRevoke[1]);
    return ok(null, 'Device signed out.');
  }

  /* ------------------------- workspace and platform ------------------------- */

  const platform = path.startsWith('/superadmin/security');
  if (platform && actor.role !== 'SuperAdmin') {
    return fail(403, 'Not permitted', 'Only platform staff can see this.', 'forbidden');
  }
  if (!platform && actor.role === 'Employee') {
    return fail(403, 'Not permitted', 'Only an administrator can see team sessions.', 'forbidden');
  }

  const tenantMatch = /^\/superadmin\/security\/tenants\/([^/]+)$/.exec(path);
  if (method === 'GET' && (path === '/security' || tenantMatch !== null)) {
    return ok(overview(platform, tenantMatch?.[1] ?? null));
  }

  const devicesMatch = /\/employees\/([^/]+)\/devices$/.exec(path);
  if (method === 'GET' && devicesMatch !== null) {
    const devices = devicesByUser.get(devicesMatch[1]) ?? [];
    // Nobody's session is "current" from an admin's point of view except their own.
    return ok(devices.map((entry) => ({ ...entry, isCurrent: false, canRevoke: true })));
  }

  const suspendMatch = /\/employees\/([^/]+)\/(suspend|reactivate)$/.exec(path);
  if (method === 'POST' && suspendMatch !== null) {
    const [, userId, action] = suspendMatch;
    const person = PEOPLE.find((entry) => entry.userId === userId);
    if (person === undefined) {
      return fail(404, 'Not found', 'That person is not in this workspace.');
    }
    if (userId === actor.userId) {
      return fail(403, 'Not permitted', 'You cannot suspend your own account.', 'cannot_suspend_self');
    }
    if (!platform && person.role === 'Admin') {
      return fail(403, 'Not permitted', "A workspace's admin can only be suspended by platform staff.", 'cannot_suspend_admin');
    }
    if (action === 'suspend') {
      suspendedIds.add(userId);
      // Every session ends with the suspension.
      devicesByUser.set(userId, (devicesByUser.get(userId) ?? []).map((entry) => ({ ...entry, isActive: false })));
    } else {
      suspendedIds.delete(userId);
    }
    return ok(employeeRow(person, platform), action === 'suspend' ? 'Account suspended.' : 'Account reactivated.');
  }

  const revokeMatch = /\/sessions\/([^/]+)\/revoke$/.exec(path);
  if (method === 'POST' && revokeMatch !== null) {
    return revoke(revokeMatch[1])
      ? ok(null, 'Session ended.')
      : fail(404, 'Not found', 'That session has already ended.');
  }

  return null;
}
