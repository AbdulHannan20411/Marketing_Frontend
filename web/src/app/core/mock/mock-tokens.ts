import type { AuthTokens, JwtClaims, Permission, UserRole } from '@core/models/auth.model';
import { PERMISSIONS } from '@core/models/auth.model';

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TENANT_USER_PERMISSIONS: readonly Permission[] = [
  'contacts.read',
  'contacts.write',
  'groups.manage',
  'tags.manage',
  'whatsapp.read',
  'templates.read',
  'campaigns.read',
  'reports.read',
];

const TENANT_OWNER_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) => !permission.startsWith('platform.'),
);

export function permissionsForRole(role: UserRole): readonly Permission[] {
  switch (role) {
    case 'PlatformAdmin':
      return PERMISSIONS;
    case 'TenantOwner':
      return TENANT_OWNER_PERMISSIONS;
    case 'TenantUser':
      return TENANT_USER_PERMISSIONS;
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
    email: 'owner@verdant.io',
    password: 'Password1!',
    name: 'Amara Chen',
    role: 'TenantOwner',
    workspaceName: 'Northwind Retail',
  },
  {
    email: 'agent@verdant.io',
    password: 'Password1!',
    name: 'Diego Rivera',
    role: 'TenantUser',
    workspaceName: 'Northwind Retail',
  },
  {
    email: 'admin@verdant.io',
    password: 'Password1!',
    name: 'Priya Raman',
    role: 'PlatformAdmin',
    workspaceName: 'Verdant Platform',
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
    email: account.email,
    name: account.name,
    role: account.role,
    permissions: permissionsForRole(account.role),
    workspaceName: account.workspaceName,
    avatarUrl: null,
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
