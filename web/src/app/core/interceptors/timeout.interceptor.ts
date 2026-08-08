import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { timeout, catchError, throwError } from 'rxjs';
import { TimeoutError } from 'rxjs';

import { environment } from '@env/environment';

/** Most calls should answer well inside this. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Long-running by design: the CSV import commit processes up to 50,000 rows
 * synchronously, and exports stream the whole result set.
 */
const LONG_RUNNING = ['/contacts/import/commit', '/contacts/export', '/templates/sync'];
const LONG_TIMEOUT_MS = 300_000;

/**
 * Fails a request that never settles.
 *
 * Without this, an unreachable or hung API leaves buttons spinning forever —
 * the browser's own timeout is minutes long and the user gets no feedback.
 * A timeout is surfaced as a status-0 error so `errorInterceptor` reports it
 * the same way as an unreachable server.
 */
export const timeoutInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiBaseUrl)) {
    return next(request);
  }

  const limit = LONG_RUNNING.some((path) => request.url.includes(path))
    ? LONG_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;

  return next(request).pipe(
    timeout(limit),
    catchError((error: unknown) => {
      if (error instanceof TimeoutError) {
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 0,
              statusText: 'Timeout',
              url: request.url,
              error: {
                title: 'The server did not respond',
                detail: `No reply within ${Math.round(limit / 1000)} seconds. Check that the API is running, then try again.`,
                errorCode: 'request_timeout',
              },
            }),
        );
      }
      return throwError(() => error);
    }),
  );
};
