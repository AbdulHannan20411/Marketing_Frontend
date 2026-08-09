import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from './admin-scope.service';

/** Query parameter naming the Admin account a SuperAdmin is viewing as. */
export const SCOPE_PARAM = 'adminId';

/**
 * Platform-level routes are inherently cross-tenant — listing every admin,
 * pricing plans, tenants, audit and system health. Scoping them to one admin is
 * meaningless at best and misleading at worst, so the parameter is never
 * attached there even while an admin is selected.
 */
const UNSCOPED_PREFIXES = ['/superadmin', '/admin/', '/plans', '/auth/'];

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

  const path = request.url.slice(environment.apiBaseUrl.length);
  if (UNSCOPED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return next(request);
  }

  const adminId = scope.selectedId();
  if (adminId === null) {
    return next(request);
  }

  return next(request.clone({ params: request.params.set(SCOPE_PARAM, adminId) }));
};
