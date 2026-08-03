import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { TokenStorageService } from '@core/auth/token-storage.service';

const AUTH_FREE_PATHS = ['/auth/login', '/auth/refresh', '/auth/forgot-password'];

function isApiRequest(url: string): boolean {
  return url.startsWith(environment.apiBaseUrl);
}

function withBearer<T>(request: HttpRequest<T>, token: string): HttpRequest<T> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * Attaches the bearer token to API calls and transparently retries once after a
 * token refresh when the server answers 401.
 *
 * No tenant identifier is ever attached — tenancy is resolved server-side from
 * the token's own claims.
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

      return auth
        .refreshToken()
        .pipe(switchMap((tokens) => next(withBearer(request, tokens.accessToken))));
    }),
  );
};
