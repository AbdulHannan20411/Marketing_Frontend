import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import type { FeatureModule } from '@core/models/permission.model';
import { EntitlementService } from '@core/services/entitlement.service';

/**
 * Blocks routes whose module is not in the current plan and sends the user to
 * the upgrade page instead of a dead end. Pair with `data: { module: '…' }`.
 */
export const featureGuard: CanActivateFn = (route) => {
  const entitlements = inject(EntitlementService);
  const router = inject(Router);

  const module = route.data['module'] as FeatureModule | undefined;
  if (module === undefined || entitlements.hasFeature(module)) {
    return true;
  }

  return router.createUrlTree(['/upgrade'], { queryParams: { module } });
};
