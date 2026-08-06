import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from './admin-scope.service';

/** Query parameter naming the Admin account a SuperAdmin is viewing as. */
export const SCOPE_PARAM = 'adminId';

/**
 * Attaches the selected Admin's id to outgoing API calls.
 *
 * This is the single sanctioned exception to "the client never names a tenant".
 * It carries an *Admin account id*, never a TenantId, and only when the caller
 * is a SuperAdmin who has explicitly chosen an account to view. The backend
 * must still authorise the caller's role before honouring it and resolve the
 * tenant itself — a forged parameter from an Admin session must be rejected
 * server-side. For every other role, requests are left untouched and tenancy
 * continues to come solely from the access token's claims.
 */
export const scopeInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiBaseUrl)) {
    return next(request);
  }

  const auth = inject(AuthService);
  const scope = inject(AdminScopeService);

  if (!auth.isSuperAdmin()) {
    return next(request);
  }

  const adminId = scope.selectedId();
  if (adminId === null) {
    return next(request);
  }

  return next(request.clone({ params: request.params.set(SCOPE_PARAM, adminId) }));
};
