import type { CanActivateChildFn } from '@angular/router';

/**
 * The only routes a locked workspace may still reach.
 *
 * Everything here exists to get the subscription working again — see the plans,
 * pay, check what was charged. `settings` stays open so the owner can still
 * reach their profile and sign-out lives there too.
 */
export const UNLOCKED_ROUTES: readonly string[] = [
  // Read-only and safe: a workspace waiting to buy a plan should land
  // somewhere that looks like the product rather than on a wall. Nothing on
  // it can be edited, and the lock notice sits at the top of it.
  'dashboard',
  'subscription',
  'billing',
  'pricing',
  'checkout',
  'settings',
  'notifications',
  'forbidden',
];

/**
 * Lets a locked workspace through to every screen.
 *
 * It used to confine an expired or unpaid workspace to its subscription
 * screens. The product decision changed: somebody who cannot see what they
 * are missing has no reason to pay for it, so the screens stay readable and
 * `PlanGateService` stops the actions — with "Purchase a plan" rather than an
 * error.
 *
 * Kept as a pass-through, with `UNLOCKED_ROUTES` above, because both are
 * where blocking would be reinstated if that decision is ever reversed.
 *
 * This was never a security boundary and is less of one now: the API must
 * refuse the same work independently.
 */
export const subscriptionLockGuard: CanActivateChildFn = () => true;
