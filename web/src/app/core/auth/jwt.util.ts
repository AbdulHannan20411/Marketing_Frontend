import type {
  AuthUser,
  CurrentUserResponse,
  JwtClaims,
  Permission,
  UserRole,
} from '@core/models/auth.model';

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Returns null for anything that is not a well-formed JWT with `sub` and `exp`. */
export function decodeJwt(token: string): JwtClaims | null {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return null;
  }

  try {
    const claims = JSON.parse(base64UrlDecode(segments[1] ?? '')) as Partial<JwtClaims>;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') {
      return null;
    }
    return claims as JwtClaims;
  } catch {
    return null;
  }
}

export function isExpired(claims: JwtClaims, skewSeconds = 30): boolean {
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
}

export function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * The `permissions` claim arrives as a single string holding a JSON array.
 * Some issuers collapse a one-element array to a bare string, so both are handled.
 */
export function parsePermissionsClaim(raw: string | undefined): readonly Permission[] {
  if (raw === undefined || raw.length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is Permission => typeof value === 'string');
    }
  } catch {
    // Not JSON — fall through to the bare-string case.
  }

  return [raw as Permission];
}

function toRole(value: string | undefined, isSuperAdmin: boolean): UserRole {
  if (value === 'SuperAdmin' || value === 'Admin' || value === 'Employee') {
    return value;
  }
  return isSuperAdmin ? 'SuperAdmin' : 'Employee';
}

/**
 * Builds the session user from `GET /auth/me`, which is authoritative — the
 * token has no email claim. Token claims fill in the display extras.
 */
/** Treats blank strings as absent — platform staff have no tenant name. */
function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

export function toAuthUser(profile: CurrentUserResponse, claims: JwtClaims | null): AuthUser {
  const isSuperAdmin = profile.isSuperAdmin;

  return {
    id: String(profile.id),
    email: profile.email,
    name: profile.displayName,
    initials: toInitials(profile.displayName),
    role: toRole(profile.roles[0] ?? claims?.role, isSuperAdmin),
    permissions: profile.permissions as readonly Permission[],
    workspaceName:
      firstNonEmpty(profile.tenantName, claims?.workspaceName) ??
      (isSuperAdmin ? 'Platform' : 'Workspace'),
    avatarUrl: firstNonEmpty(claims?.avatarUrl),
    isSuperAdmin,
  };
}
