import type { AuthTokens, JwtClaims, Permission, UserRole } from '@core/models/auth.model';
import { PERMISSIONS } from '@core/models/auth.model';

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Employees are deliberately not given a blanket grant — they start with a
 * modest read-focused set that an Admin then extends via the permission matrix.
 */
export const EMPLOYEE_DEFAULT_PERMISSIONS: readonly Permission[] = [
  'dashboard.view',
  'dashboard.statistics',
  'contacts.view',
  'contacts.create',
  'contacts.edit',
  'whatsapp.templates.view',
  'whatsapp.campaigns.create',
  'whatsapp.campaigns.reports',
  'reports.view',
];

/** Admins run their own workspace but hold nothing cross-tenant. */
const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) => !permission.startsWith('platform.'),
);

export function permissionsForRole(role: UserRole): readonly Permission[] {
  switch (role) {
    case 'SuperAdmin':
      return PERMISSIONS;
    case 'Admin':
      return ADMIN_PERMISSIONS;
    case 'Employee':
      return EMPLOYEE_DEFAULT_PERMISSIONS;
  }
}

export interface MockAccount {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly role: UserRole;
  readonly workspaceName: string;
}

export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  {
    email: 'admin@nextreach.io',
    password: 'Password1!',
    name: 'Amara Chen',
    role: 'Admin',
    workspaceName: 'Northwind Retail',
  },
  {
    email: 'employee@nextreach.io',
    password: 'Password1!',
    name: 'Diego Rivera',
    role: 'Employee',
    workspaceName: 'Northwind Retail',
  },
  {
    email: 'superadmin@nextreach.io',
    password: 'Password1!',
    name: 'Priya Raman',
    role: 'SuperAdmin',
    workspaceName: 'NextReach Platform',
  },
];

const TOKEN_LIFETIME_SECONDS = 60 * 30;

/**
 * Builds an unsigned, structurally valid JWT so the real decoder and
 * interceptors run unchanged against the mock backend.
 */
export function issueMockTokens(account: MockAccount): AuthTokens {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    sub: `usr_${account.email.split('@')[0]}`,
    // The real issuer carries no email claim; the profile comes from /auth/me.
    name: account.name,
    role: account.role,
    // Mirrors the real issuer: one claim holding a JSON array.
    permissions: JSON.stringify(permissionsForRole(account.role)),
    workspaceName: account.workspaceName,
    avatarUrl: undefined,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify(claims));

  return {
    accessToken: `${header}.${payload}.mock-signature`,
    refreshToken: `refresh_${base64UrlEncode(account.email)}`,
    expiresAtUtc: new Date(claims.exp * 1000).toISOString(),
  };
}

export function accountFromRefreshToken(refreshToken: string): MockAccount | null {
  return (
    MOCK_ACCOUNTS.find((account) => issueMockTokens(account).refreshToken === refreshToken) ?? null
  );
}
