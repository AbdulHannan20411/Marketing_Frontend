import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { deviceId } from '@core/auth/device-id';
import { TokenStorageService } from '@core/auth/token-storage.service';
import {
  ACCOUNT_SUSPENDED_CODE,
  SESSION_REVOKED_HEADER,
  SESSION_REVOKED_REASON_HEADER,
  SIGNED_OUT_BY_ADMIN,
  SIGNED_OUT_ELSEWHERE,
  SIGNED_OUT_SUSPENDED,
  errorCodeOf,
} from '@core/models/session-security.model';

const DEVICE_ID_HEADER = 'X-Device-Id';

/** Endpoints that must never carry a bearer token or trigger a refresh. */
const AUTH_FREE_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/accept-invitation',
];

function isApiRequest(url: string): boolean {
  return url.startsWith(environment.apiBaseUrl);
}

function withBearer<T>(request: HttpRequest<T>, token: string): HttpRequest<T> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * Ended rather than expired: another sign-in, or an admin, closed this session.
 *
 * Refreshing is pointless — the refresh token died with it — and would only
 * turn a clear "signed in elsewhere" into an unexplained sign-out.
 */
function isRevoked(error: HttpErrorResponse): boolean {
  return error.headers.get(SESSION_REVOKED_HEADER)?.toLowerCase() === 'true';
}

/** Why the session ended, for the login page: a suspension reads very differently from a displacement. */
function revokedReason(error: HttpErrorResponse): string {
  const reason = error.headers.get(SESSION_REVOKED_REASON_HEADER)?.toLowerCase() ?? errorCodeOf(error);
  if (reason === ACCOUNT_SUSPENDED_CODE) {
    return SIGNED_OUT_SUSPENDED;
  }
  return reason === 'ended_by_admin' ? SIGNED_OUT_BY_ADMIN : SIGNED_OUT_ELSEWHERE;
}

/**
 * Attaches the bearer token and retries once after a refresh when the server
 * answers 401.
 *
 * The refresh itself is single-flight inside `AuthService`, which matters more
 * than usual here: the API rotates refresh tokens and treats a replayed one as
 * theft, revoking every session. Two parallel refreshes would sign the user out.
 *
 * A 401 that survives the retry is a finished session — the server revokes
 * tokens immediately on permission, role, status and password changes — so it
 * is propagated rather than retried again.
 *
 * No tenant identifier is ever attached; tenancy comes from the token's claims.
 */
export const authTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const storage = inject(TokenStorageService);
  const auth = inject(AuthService);

  if (!isApiRequest(request.url)) {
    return next(request);
  }

  // Every API call, sign-in included: the device a session starts on is the
  // one it is tracked against, so the login request needs it most of all.
  const tracked = request.clone({ setHeaders: { [DEVICE_ID_HEADER]: deviceId() } });

  const skipAuth = AUTH_FREE_PATHS.some((path) => request.url.includes(path));
  if (skipAuth) {
    return next(tracked);
  }

  const token = storage.accessToken;
  const authorized = token === null ? tracked : withBearer(tracked, token);

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      if (isRevoked(error)) {
        auth.endRevokedSession(revokedReason(error));
        return throwError(() => error);
      }

      return auth.refreshToken().pipe(
        switchMap((tokens) =>
          next(withBearer(tracked, tokens.accessToken)).pipe(
            catchError((retryError: unknown) => {
              if (retryError instanceof HttpErrorResponse && retryError.status === 401) {
                if (isRevoked(retryError)) {
                  auth.endRevokedSession(revokedReason(retryError));
                } else {
                  auth.clearSession();
                }
              }
              return throwError(() => retryError);
            }),
          ),
        ),
      );
    }),
  );
};
