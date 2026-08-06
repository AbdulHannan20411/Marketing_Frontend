import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';

/**
 * Keeps each role in its own portal.
 *
 * A SuperAdmin landing on an Admin route is forwarded to the equivalent
 * `/superadmin` page; anyone else attempting `/superadmin` is refused.
 */
export const adminPortalGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isSuperAdmin()) {
    return true;
  }

  // `/contacts` → `/superadmin/contacts`, preserving deep links.
  return router.createUrlTree([`/superadmin${state.url.split('?')[0]}`]);
};

export const superAdminPortalGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isSuperAdmin() ? true : router.createUrlTree(['/forbidden']);
};
