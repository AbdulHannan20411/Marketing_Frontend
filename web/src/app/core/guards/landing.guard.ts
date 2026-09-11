import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { LayoutService } from '@core/services/layout.service';

/**
 * Sends a signed-in user to the first screen they can actually open.
 *
 * The default landing used to be `/dashboard` for everyone. That is fine for an
 * administrator and wrong for a restricted employee: an employee invited with
 * no permissions was redirected to a screen they had no right to, whose
 * endpoints answered `403`, and the first thing they ever saw of the product
 * was a page of errors.
 *
 * `visibleNavigation` already knows what a user can reach — it is what builds
 * the sidebar — so the landing route is simply its first entry. Deriving it
 * rather than hard-coding one means the answer cannot drift from the menu.
 *
 * With nothing reachable at all, `/forbidden` is the honest destination: it
 * says access has not been granted yet, which is exactly the situation, and it
 * calls no endpoints on the way.
 */
export const landingGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const layout = inject(LayoutService);

  // Super Admins run their own portal with its own navigation and landing.
  if (auth.isSuperAdmin()) {
    return router.createUrlTree(['/superadmin/dashboard']);
  }

  const first = layout.visibleNavigation().flatMap((section) => section.items)[0];
  return router.createUrlTree([first?.route ?? '/forbidden']);
};
