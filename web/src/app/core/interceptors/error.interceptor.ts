import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/services/toast.service';
import type { ApiError } from '@core/models/api.model';

interface ProblemDetails {
  readonly title?: string;
  readonly detail?: string;
  readonly errors?: Record<string, string[]>;
  readonly traceId?: string;
}

function toApiError(response: HttpErrorResponse): ApiError {
  const problem = (response.error ?? {}) as ProblemDetails;
  return {
    status: response.status,
    title: problem.title ?? defaultTitle(response.status),
    detail: problem.detail ?? response.message,
    fieldErrors: problem.errors ?? {},
    traceId: problem.traceId ?? null,
  };
}

function defaultTitle(status: number): string {
  switch (status) {
    case 0:
      return 'Network unavailable';
    case 400:
      return 'Invalid request';
    case 403:
      return 'Not permitted';
    case 404:
      return 'Not found';
    case 409:
      return 'Conflict';
    case 422:
      return 'Validation failed';
    case 429:
      return 'Too many requests';
    default:
      return status >= 500 ? 'Something went wrong' : 'Request failed';
  }
}

/**
 * Normalises every failure into `ApiError` and surfaces a toast, except for
 * 401 (handled by the token interceptor) and 422 (rendered inline on forms).
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const toast = inject(ToastService);
  const auth = inject(AuthService);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      const apiError = toApiError(error);

      if (apiError.status === 401) {
        auth.clearSession();
        return throwError(() => apiError);
      }

      if (apiError.status !== 422) {
        toast.error(apiError.title, apiError.detail);
      }

      return throwError(() => apiError);
    }),
  );
};
