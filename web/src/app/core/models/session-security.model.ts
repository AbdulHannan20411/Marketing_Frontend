/**
 * Session security: one session per account, device tracking, and the evidence
 * that a seat is being shared.
 *
 * Signing in ends every other session of the account, so "active sessions" can
 * never exceed the number of people. The number that reveals sharing is
 * `displacedLast24Hours` — how often a new sign-in pushed another one off.
 */

export type DeviceType = 'desktop' | 'mobile' | 'tablet';

export interface DeviceSession {
  /** What revoke takes. */
  readonly sessionId: string;
  readonly deviceLabel: string;
  readonly browser: string;
  readonly operatingSystem: string;
  readonly deviceType: DeviceType;
  readonly ipAddress: string;
  /** `null` when the edge supplies no location, e.g. running locally. */
  readonly location: string | null;
  readonly firstSeenAt: string;
  readonly lastActiveAt: string;
  /** Seen in the last five minutes. */
  readonly isActive: boolean;
  /** This browser. Revoking it would just be signing out, so it is never offered. */
  readonly isCurrent: boolean;
  readonly canRevoke: boolean;
  readonly signIns: number;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface SecurityRisk {
  readonly level: RiskLevel;
  readonly score: number;
  /** The evidence — and the answer to a customer who disputes the level. */
  readonly reasons: readonly string[];
}

export type SecurityAccountStatus = 'active' | 'invited' | 'suspended';

export interface SecurityEmployee {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly activeSessions: number;
  readonly devices: number;
  readonly lastActiveAt: string | null;
  readonly displacedLast24Hours: number;
  /**
   * Always `null` on the workspace endpoint, by design: an admin sees facts
   * about their own staff, never a "suspected cheat" label. Platform staff
   * get the score.
   */
  readonly risk: SecurityRisk | null;
  /** Absent from an API that predates suspension; treated as active. */
  readonly status?: SecurityAccountStatus;
  /**
   * The server's answer to "may the viewer suspend this person?" — false for
   * yourself, for a workspace's own admin seen from that workspace, and for
   * platform staff. Absent from an older API; `canSuspendFrom` then decides.
   */
  readonly canSuspend?: boolean;
}

export interface SecurityOverview {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly planName: string;
  /** `null` = no seat ceiling. */
  readonly purchasedSeats: number | null;
  readonly usedSeats: number;
  readonly activeSessions: number;
  /** Across everyone, over the last `deviceWindowDays` days. */
  readonly uniqueDevices: number;
  readonly deviceWindowDays: number;
  readonly employees: readonly SecurityEmployee[];
}

/** Where the security screen is being viewed from. */
export type SecurityScope =
  | { readonly kind: 'workspace' }
  | { readonly kind: 'platform'; readonly tenantId: string };

/* ------------------------------------------------------------------ *
 * Thresholds — the same ones the server alerts on
 * ------------------------------------------------------------------ */

/** More devices than this in the window is worth a look. */
export const DEVICE_ALERT_THRESHOLD = 3;

/** This many sign-ins pushing another off in a day suggests a shared login. */
export const DISPLACEMENT_ALERT_THRESHOLD = 3;

export function hasManyDevices(employee: Pick<SecurityEmployee, 'devices'>): boolean {
  return employee.devices > DEVICE_ALERT_THRESHOLD;
}

export function isFrequentlyDisplaced(employee: Pick<SecurityEmployee, 'displacedLast24Hours'>): boolean {
  return employee.displacedLast24Hours >= DISPLACEMENT_ALERT_THRESHOLD;
}

export function needsAttention(employee: SecurityEmployee): boolean {
  return hasManyDevices(employee) || isFrequentlyDisplaced(employee);
}

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = { high: 0, medium: 1, low: 2 };

/**
 * Riskiest first when there is a score; otherwise whoever crossed a threshold
 * first, then by name. The API already sorts the platform view, but the client
 * sorts too so both views read the same way.
 */
export function sortForReview(employees: readonly SecurityEmployee[]): readonly SecurityEmployee[] {
  return [...employees].sort((left, right) => {
    const byRisk =
      (left.risk === null ? 3 : RISK_ORDER[left.risk.level]) - (right.risk === null ? 3 : RISK_ORDER[right.risk.level]);
    if (byRisk !== 0) {
      return byRisk;
    }
    const byAttention = Number(needsAttention(right)) - Number(needsAttention(left));
    return byAttention !== 0 ? byAttention : left.name.localeCompare(right.name);
  });
}

/* ------------------------------------------------------------------ *
 * Suspending from the security screen
 * ------------------------------------------------------------------ */

/**
 * How loudly the security checks are alerting about one person.
 *
 * Platform staff have the server's risk score: low, medium (a warning) or high.
 * A workspace admin never sees a score, by design, so the same thresholds the
 * "Worth a look" count uses stand in for it: crossing one is a warning.
 */
export type SecurityAlertLevel = 'low' | 'warning' | 'high';

export function securityAlertLevel(employee: SecurityEmployee): SecurityAlertLevel {
  if (employee.risk !== null) {
    return employee.risk.level === 'high' ? 'high' : employee.risk.level === 'medium' ? 'warning' : 'low';
  }
  return needsAttention(employee) ? 'warning' : 'low';
}

/**
 * Suspending someone the checks are not worried about is the unusual case, so
 * it asks first. At a warning or above the evidence is already on screen, and
 * a dialog would only slow down the response to a shared or stolen login.
 */
export function suspendNeedsConfirmation(level: SecurityAlertLevel): boolean {
  return level === 'low';
}

/** Security checks — and so suspension from here — never apply to platform staff. */
export function isPlatformStaff(employee: Pick<SecurityEmployee, 'role'>): boolean {
  return employee.role.replace(/\s+/g, '').toLowerCase() === 'superadmin';
}

export function isSuspended(employee: Pick<SecurityEmployee, 'status'>): boolean {
  return employee.status === 'suspended';
}

/**
 * Whether to offer Suspend on a row. The server's `canSuspend` wins; without
 * it, the same rules it applies: never platform staff, never yourself, and
 * from a workspace, never its admin.
 */
export function canSuspendFrom(
  employee: SecurityEmployee,
  view: 'workspace' | 'platform',
  isViewer: boolean,
): boolean {
  if (isPlatformStaff(employee) || isViewer) {
    return false;
  }
  if (employee.canSuspend !== undefined) {
    return employee.canSuspend;
  }
  return view === 'platform' || employee.role.toLowerCase() !== 'admin';
}

export const SUSPEND_REASON_MAX = 500;

export interface SuspendAccountRequest {
  /** Optional note for the audit log and the person's sign-in message. */
  readonly reason: string | null;
  /** What the checks said when the button was pressed, recorded with the action. */
  readonly alertLevel: SecurityAlertLevel;
}

/* ------------------------------------------------------------------ *
 * Signed-out reasons
 * ------------------------------------------------------------------ */

/** Set on a 401 when the session was ended rather than merely expired. */
export const SESSION_REVOKED_HEADER = 'X-Session-Revoked';

/**
 * Why it was ended, beside `X-Session-Revoked`: `signed_in_elsewhere`,
 * `ended_by_admin` or `account_suspended`. Absent from an API that predates
 * it, which reads as signed in elsewhere — the usual case.
 */
export const SESSION_REVOKED_REASON_HEADER = 'X-Session-Revoked-Reason';

export const SIGNED_OUT_BY_ADMIN = 'You were signed out because an administrator ended this session.';

export const SIGNED_OUT_ELSEWHERE =
  'You were signed out because this account signed in on another device.';

/** The API's code for a suspended account, on sign-in, refresh and ended sessions. */
export const ACCOUNT_SUSPENDED_CODE = 'account_suspended';

export const SIGNED_OUT_SUSPENDED =
  'This account has been suspended. Contact your workspace admin to have it reactivated.';

/** The `errorCode` of a failed API response, wherever the body put it. */
export function errorCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const direct = (error as { errorCode?: unknown }).errorCode;
  if (typeof direct === 'string') {
    return direct;
  }
  const body = (error as { error?: unknown }).error;
  const nested = typeof body === 'object' && body !== null ? (body as { errorCode?: unknown }).errorCode : undefined;
  return typeof nested === 'string' ? nested : null;
}
