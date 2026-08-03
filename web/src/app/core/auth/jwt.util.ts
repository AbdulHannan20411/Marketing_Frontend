import type { AuthUser, JwtClaims } from '@core/models/auth.model';

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Returns null for anything that is not a well-formed, fully-claimed JWT. */
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

function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function toAuthUser(claims: JwtClaims): AuthUser {
  return {
    id: claims.sub,
    email: claims.email,
    name: claims.name,
    initials: toInitials(claims.name),
    role: claims.role,
    permissions: claims.permissions ?? [],
    workspaceName: claims.workspaceName,
    avatarUrl: claims.avatarUrl ?? null,
  };
}
