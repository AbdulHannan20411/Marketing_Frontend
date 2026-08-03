import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import type { Permission, UserRole } from '@core/models/auth.model';

/**
 * Route data contract for authorisation:
 * `{ data: { permissions: ['contacts.read'], roles: ['TenantOwner'] } }`
 */
export interface AuthorizationRouteData {
  readonly permissions?: readonly Permission[];
  readonly roles?: readonly UserRole[];
}

export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const data = route.data as AuthorizationRouteData;

  const roleOk = data.roles === undefined || auth.hasRole(data.roles);
  const permissionOk = data.permissions === undefined || auth.hasAnyPermission(data.permissions);

  return roleOk && permissionOk ? true : router.createUrlTree(['/forbidden']);
};
