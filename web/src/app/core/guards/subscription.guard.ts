import { inject } from '@angular/core';
import { Router, type CanActivateChildFn } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { EntitlementService } from '@core/services/entitlement.service';

/**
 * The only routes a locked workspace may still reach.
 *
 * Everything here exists to get the subscription working again — see the plans,
 * pay, check what was charged. `settings` stays open so the owner can still
 * reach their profile and sign-out lives there too.
 */
export const UNLOCKED_ROUTES: readonly string[] = [
  'subscription',
  'billing',
  'pricing',
  'checkout',
  'settings',
  'notifications',
  'forbidden',
];

/**
 * Confines a suspended or expired workspace to its subscription screens.
 *
 * They are deliberately *not* blocked from signing in: the person who can
 * settle the account is the one signing in, and locking them out at the door
 * leaves them no route back. Instead every working screen redirects to
 * `/subscription`, where the reason and the way out are stated.
 *
 * Super Admins are exempt — they are platform staff, and a billing state is not
 * a reason to stop them working inside a customer's workspace.
 *
 * This is a usability boundary, not a security one. The API must refuse the
 * same work independently; a client-side redirect stops nobody determined.
 */
export const subscriptionLockGuard: CanActivateChildFn = (route) => {
  const auth = inject(AuthService);
  const entitlements = inject(EntitlementService);
  const router = inject(Router);

  if (auth.isSuperAdmin() || !entitlements.isLocked()) {
    return true;
  }

  // Match on the first segment so `/contacts/import` is judged as `contacts`.
  const target = route.routeConfig?.path?.split('/')[0] ?? '';
  return UNLOCKED_ROUTES.includes(target) ? true : router.createUrlTree(['/subscription']);
};
