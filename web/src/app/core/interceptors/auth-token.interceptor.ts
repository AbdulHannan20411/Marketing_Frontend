import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { TokenStorageService } from '@core/auth/token-storage.service';

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

  const skipAuth = AUTH_FREE_PATHS.some((path) => request.url.includes(path));
  if (!isApiRequest(request.url) || skipAuth) {
    return next(request);
  }

  const token = storage.accessToken;
  const authorized = token === null ? request : withBearer(request, token);

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      return auth.refreshToken().pipe(
        switchMap((tokens) =>
          next(withBearer(request, tokens.accessToken)).pipe(
            catchError((retryError: unknown) => {
              if (retryError instanceof HttpErrorResponse && retryError.status === 401) {
                auth.clearSession();
              }
              return throwError(() => retryError);
            }),
          ),
        ),
      );
    }),
  );
};
