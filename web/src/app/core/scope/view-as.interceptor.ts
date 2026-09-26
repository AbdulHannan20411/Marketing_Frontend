import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';

/** Query parameter naming the teammate whose view a read is answered as. */
export const VIEW_AS_PARAM = 'viewAsEmployeeId';

/**
 * Paths the parameter never reaches.
 *
 * Matched by **path segment**, not prefix, so a future `/administrators` is
 * not caught by `/admin` — the same rule the API matches on, kept identical
 * here so the two cannot disagree about which routes are excluded.
 *
 * `/auth` matters most: it must keep answering for the real caller, or the
 * banner would render the previewed teammate's profile and take the way out
 * with it.
 */
const UNSCOPED_SEGMENTS = ['superadmin', 'admin', 'plans', 'auth'];

/**
 * Attaches the previewed teammate to outgoing reads.
 *
 * **Reads only.** A write carrying it is refused by the API with
 * `view_as_is_read_only` — deliberately loud, because ignoring it would
 * perform the write as the administrator while the screen said otherwise. The
 * client does not send it on writes at all, so that refusal is a backstop
 * rather than a path anyone should hit.
 *
 * Nothing here is a security boundary: the API authorises the caller as
 * themselves first, then narrows what the endpoint can see. This only asks.
 */
export const viewAsInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiBaseUrl)) {
    return next(request);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return next(request);
  }

  const auth = inject(AuthService);

  // Only when the API will actually honour it. Sending it to an API that
  // ignores it would leave the banner claiming to show somebody else's data
  // while showing the caller's own.
  const subject = auth.isViewingData() ? auth.viewingAs() : null;
  if (subject === null) {
    return next(request);
  }

  const path = request.url.slice(environment.apiBaseUrl.length);
  const [firstSegment] = path.replace(/^\//, '').split('/');
  if (UNSCOPED_SEGMENTS.includes(firstSegment)) {
    return next(request);
  }

  return next(request.clone({ params: request.params.set(VIEW_AS_PARAM, subject.id) }));
};
