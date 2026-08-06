import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AdminScopeService } from '@core/scope/admin-scope.service';

/**
 * Guards Super Admin module routes that only make sense inside an Admin's
 * context. With no Admin selected the user is sent to the picker, carrying the
 * intended destination so selection can continue straight there.
 */
export const scopeGuard: CanActivateFn = (_route, state) => {
  const scope = inject(AdminScopeService);
  const router = inject(Router);

  if (scope.isScoped()) {
    return true;
  }

  return router.createUrlTree(['/superadmin/admins'], {
    queryParams: { next: state.url },
  });
};
