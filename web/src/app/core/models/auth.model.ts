import type { Permission } from './permission.model';

export type UserRole = 'SuperAdmin' | 'Admin' | 'Employee';

export const USER_ROLE_LABEL: Readonly<Record<UserRole, string>> = {
  SuperAdmin: 'Super Admin',
  Admin: 'Admin',
  Employee: 'Employee',
};

export type { Permission };
export { PERMISSIONS } from './permission.model';

/** Which sign-in entrance was used. The API refuses a mismatch like a bad password. */
export type LoginPortal = 'admin' | 'superadmin';

/**
 * Claims on the access token.
 *
 * Two shapes differ from the obvious: `role` is a **single string**, not an
 * array, and `permissions` is **one claim holding a JSON array as a string**.
 * `jwt.util.ts` normalises both. There is no `email` claim — the profile comes
 * from `GET /auth/me`.
 */
export interface JwtClaims {
  readonly sub: string;
  readonly name?: string;
  readonly role?: string;
  readonly permissions?: string;
  readonly workspaceName?: string;
  readonly avatarUrl?: string;
  readonly sid?: string;
  readonly exp: number;
  readonly iat?: number;
}

/** `GET /auth/me` — the authoritative profile. */
export interface CurrentUserResponse {
  readonly id: number;
  readonly email: string;
  readonly displayName: string;
  readonly tenantName: string | null;
  readonly isSuperAdmin: boolean;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
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
  readonly isSuperAdmin: boolean;
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
  readonly portal?: LoginPortal | null;
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

export interface AcceptInvitationRequest {
  readonly token: string;
  readonly password: string;
}

export interface ChangePasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
}
