export type UserRole = 'PlatformAdmin' | 'TenantOwner' | 'TenantUser';

export const PERMISSIONS = [
  'contacts.read',
  'contacts.write',
  'contacts.delete',
  'groups.manage',
  'tags.manage',
  'whatsapp.read',
  'whatsapp.connect',
  'templates.read',
  'templates.write',
  'campaigns.read',
  'campaigns.write',
  'campaigns.send',
  'reports.read',
  'reports.export',
  'settings.manage',
  'team.manage',
  'platform.tenants',
  'platform.audit',
  'platform.quotas',
  'platform.monitoring',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Claims we read from the access token.
 *
 * The token also carries a tenant claim used for server-side isolation. It is
 * deliberately absent from this interface: the client must never read, store,
 * or transmit a tenant identifier. `workspaceName` is a display label only.
 */
export interface JwtClaims {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly permissions: readonly Permission[];
  readonly workspaceName: string;
  readonly avatarUrl: string | null;
  /** Expiry, seconds since epoch. */
  readonly exp: number;
  readonly iat: number;
}

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly initials: string;
  readonly role: UserRole;
  readonly permissions: readonly Permission[];
  readonly workspaceName: string;
  readonly avatarUrl: string | null;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAtUtc: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
  readonly rememberMe: boolean;
}

export interface RefreshTokenRequest {
  readonly refreshToken: string;
}

export interface ForgotPasswordRequest {
  readonly email: string;
}

export interface ResetPasswordRequest {
  readonly token: string;
  readonly password: string;
}
