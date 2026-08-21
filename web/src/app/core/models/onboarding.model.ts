/**
 * Product tour state and steps.
 *
 * Steps are **derived from the sidebar**, not listed separately: `NAVIGATION`
 * already knows which items a user can reach, and `LayoutService.visibleNavigation`
 * already filters by permission, role, plan module and workspace lock. Keeping a
 * second list in step with that one is a losing game — a tour that offers a tab
 * the user cannot open is worse than no tour.
 *
 * What lives here is the *copy*: which routes are worth a step, in what order,
 * and what each one says.
 */

export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export interface OnboardingState {
  readonly status: OnboardingStatus;
  /** Where an interrupted run had got to, so a refresh resumes rather than restarts. */
  readonly stepIndex: number;
  /**
   * ISO instant of the last change, set by the server.
   *
   * **Null for a user nothing has been stored for** — that is the column
   * default rather than a special case, so a first sign-in needs no branch.
   * Anything rendering this has to handle the null.
   */
  readonly updatedAt: string | null;
}

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  status: 'not_started',
  stepIndex: 0,
  updatedAt: null,
};

/** One resolved step: a nav route that exists for this user, plus its copy. */
export interface TourStep {
  /** The nav route. Doubles as the step id and the `data-tour` value. */
  readonly route: string;
  readonly title: string;
  readonly description: string;
}

/** The copy, before filtering. See `OnboardingService.steps`. */
export interface TourStepContent {
  readonly route: string;
  readonly title: string;
  readonly description: string;
}
