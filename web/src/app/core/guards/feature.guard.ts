import type { CanActivateFn } from '@angular/router';

/**
 * Lets every route through, whatever the plan covers.
 *
 * It used to redirect a module the plan did not include to `/upgrade`. That
 * made the product invisible to the people most likely to pay for it: a
 * workspace on a small plan saw a menu of dead ends, and a workspace with no
 * plan saw almost nothing at all.
 *
 * Screens are now readable regardless, and the plan is enforced on the
 * **actions** — `PlanGateService` stops the write and offers the plan that
 * would allow it. The guard stays so routes keep declaring which module they
 * belong to, and so there is one place to reinstate blocking if that decision
 * is ever reversed.
 */
export const featureGuard: CanActivateFn = () => true;
