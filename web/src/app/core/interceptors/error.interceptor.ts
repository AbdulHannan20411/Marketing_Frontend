import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/services/toast.service';
import type { ApiError } from '@core/models/api.model';

/** RFC 7807 document as returned by the API. Failures are never wrapped. */
interface ProblemDetails {
  readonly title?: string;
  readonly detail?: string;
  readonly status?: number;
  readonly errorCode?: string;
  readonly errors?: Record<string, string[]>;
  readonly traceId?: string;
  readonly exceptionId?: string;
}

/**
 * Business-rule failures the API reports as 409 rather than 422. They carry a
 * user-facing `detail` and no field map, so they are shown as a message rather
 * than bound to a form control.
 */
const BUSINESS_RULE_CODES = new Set([
  'contact_limit_reached',
  'seat_limit_reached',
  'downgrade_blocked',
  'contact_exists',
  'group_name_taken',
  'tag_name_taken',
  'permission_not_in_plan',
  'last_admin',
  'cannot_target_self',
  'role_derived_permissions',
  'email_taken',
  'not_invited',
  'invalid_campaign_transition',
  'campaign_not_editable',
  'empty_audience',
  'whatsapp_not_connected',
  'whatsapp_verification_failed',
  'payment_method_required',
  'not_cancelled',
  'subscription_lapsed',
  'duplicate_record',
]);

export function isBusinessRule(error: ApiError): boolean {
  return BUSINESS_RULE_CODES.has(error.errorCode);
}

function toApiError(response: HttpErrorResponse): ApiError {
  const problem = (response.error ?? {}) as ProblemDetails;
  const errorCode = problem.errorCode ?? '';

  // The API scopes reads by `adminId` but refuses writes with it, so a Super
  // Admin acting inside an admin's workspace gets "Tenant Not Resolved". That
  // wording explains nothing to the person who clicked Save.
  if (errorCode === 'tenant_not_resolved') {
    return {
      status: response.status,
      title: 'Cannot save into this workspace',
      detail:
        'The API does not yet accept changes made on behalf of another admin. Viewing their data works; saving does not.',
      errorCode,
      fieldErrors: {},
      traceId: problem.traceId ?? null,
      exceptionId: problem.exceptionId ?? null,
    };
  }

  return {
    status: response.status,
    title: problem.title ?? defaultTitle(response.status),
    detail: problem.detail ?? defaultDetail(response.status, response.message),
    errorCode,
    fieldErrors: problem.errors ?? {},
    traceId: problem.traceId ?? null,
    exceptionId: problem.exceptionId ?? null,
  };
}

function defaultTitle(status: number): string {
  switch (status) {
    case 0:
      return 'Cannot reach the server';
    case 400:
      return 'Invalid request';
    case 403:
      return 'Not permitted';
    case 404:
      return 'Not found';
    case 409:
      return 'Cannot complete that';
    case 422:
      return 'Validation failed';
    case 429:
      return 'Too many requests';
    case 501:
      return 'Not available yet';
    case 502:
      return 'WhatsApp rejected the request';
    case 503:
      return 'Service temporarily unavailable';
    default:
      return status >= 500 ? 'Something went wrong' : 'Request failed';
  }
}

function defaultDetail(status: number, fallback: string): string {
  if (status === 0) {
    // Also what a rate-limited /auth/* looks like: the connection is dropped.
    return 'The server did not respond. Check that the API is running, then try again.';
  }
  if (status === 502) {
    return 'WhatsApp could not process that request.';
  }
  if (status === 503) {
    return 'WhatsApp is temporarily unavailable. Try again shortly.';
  }
  return fallback;
}

/**
 * Normalises every failure into `ApiError` and decides what the user sees.
 *
 * Silent (the caller renders them): 422 and business-rule 409 bind to forms,
 * 404 becomes an empty state, and 401 is handled by the token interceptor.
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
        // The token interceptor owns refresh; a 401 that reaches here after a
        // refresh attempt means the session is genuinely finished.
        if (!request.url.includes('/auth/')) {
          auth.clearSession();
        }
        return throwError(() => apiError);
      }

      if (apiError.status === 429) {
        const retryAfter = Number(error.headers.get('Retry-After') ?? '0');
        toast.warning(
          apiError.title,
          retryAfter > 0
            ? `Please wait ${retryAfter} seconds before trying again.`
            : apiError.detail,
        );
        return throwError(() => apiError);
      }

      const handledByCaller =
        apiError.status === 422 || apiError.status === 404 || isBusinessRule(apiError);

      if (!handledByCaller) {
        toast.error(apiError.title, apiError.detail);
      }

      return throwError(() => apiError);
    }),
  );
};
