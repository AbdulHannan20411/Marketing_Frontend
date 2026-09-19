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
 * Signed-out reasons
 * ------------------------------------------------------------------ */

/** Set on a 401 when the session was ended rather than merely expired. */
export const SESSION_REVOKED_HEADER = 'X-Session-Revoked';

export const SIGNED_OUT_ELSEWHERE =
  'You were signed out because this account signed in on another device.';
