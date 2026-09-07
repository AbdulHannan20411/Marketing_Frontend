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

/** One resolved step: a route this user can reach, plus its copy and target. */
export interface TourStep {
  /** The route the step lives on. Navigated to before the step is shown. */
  readonly route: string;
  /**
   * The `data-tour` value to point at.
   *
   * For the general tour this is the route itself, which is what the sidebar
   * link carries. Module tours point at elements on the page instead, so they
   * name their own target.
   */
  readonly target: string;
  readonly title: string;
  readonly description: string;
}

/** The copy, before filtering. See `OnboardingService.steps`. */
export interface TourStepContent {
  readonly route: string;
  readonly title: string;
  readonly description: string;
  /**
   * `data-tour` value of the element to highlight.
   *
   * Omitted for the general tour, where the target is the sidebar link and its
   * `data-tour` is the route. Module tours set it to an element on the page.
   *
   * **A target that never appears is skipped, not an error.** That is how
   * state-dependent steps work: a tour can carry both a "connect your account"
   * step and an "your account is connected" step, and whichever one is on
   * screen is the one the user sees. See `OnboardingService.moveTo`.
   */
  readonly target?: string;
}

/* ------------------------------------------------------------------ *
 * The tour registry
 * ------------------------------------------------------------------ */

/**
 * `general` walks the whole product; `module` teaches one feature in depth.
 *
 * The distinction is not cosmetic — only the general tour is remembered as
 * "seen" and auto-started on first login. A module tour is something a user
 * asks for, so it runs on demand and never blocks anyone.
 */
export type GuidedTourType = 'general' | 'module';

export interface GuidedTour {
  readonly id: string;
  /** Shown in Settings. */
  readonly title: string;
  readonly description: string;
  readonly type: GuidedTourType;
  /** The feature this teaches. Present on module tours only. */
  readonly module?: string;
  /**
   * The nav route the tour is about.
   *
   * A tour is only offered when this route is in the user's sidebar, so a
   * workspace without the WhatsApp module never sees a WhatsApp tour listed.
   * Absent on the general tour, which is about the whole product.
   */
  readonly requiresRoute?: string;
  readonly steps: readonly TourStepContent[];
}
