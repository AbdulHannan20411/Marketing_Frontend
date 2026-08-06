import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';

/** The two entrances. Which one applies is decided by the URL being attempted. */
export const ADMIN_LOGIN_URL = '/auth/login';
export const SUPERADMIN_LOGIN_URL = '/superadmin/login';

function loginUrlFor(attemptedUrl: string): string {
  return attemptedUrl.startsWith('/superadmin') ? SUPERADMIN_LOGIN_URL : ADMIN_LOGIN_URL;
}

/** Blocks unauthenticated access and remembers where the user was heading. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree([loginUrlFor(state.url)], {
    queryParams: { returnUrl: state.url },
  });
};

/** Keeps signed-in users out of the auth screens, on their own portal's home. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree([
    auth.isSuperAdmin() ? '/superadmin/dashboard' : '/dashboard',
  ]);
};
