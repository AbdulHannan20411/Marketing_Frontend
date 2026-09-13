import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { GENERAL_TOUR_ID, GUIDED_TOURS, findTour } from '@core/config/tours.config';
import type { GuidedTour, OnboardingStatus, TourStep } from '@core/models/onboarding.model';
import { EntitlementService } from './entitlement.service';
import { LayoutService } from './layout.service';
import { OnboardingStoreService } from './onboarding-store.service';

/** How long to wait for a step's target after navigating to its route. */
const TARGET_TIMEOUT_MS = 2500;

/**
 * How long to keep waiting for a target once the page reports `data-tour-ready`.
 *
 * Short on purpose: the page is rendered and its data has arrived, so an
 * element that is not there belongs to a state the workspace is not in. It
 * only ever shortens the wait — a target that exists is shown immediately.
 */
const SETTLED_ROUTE_TIMEOUT_MS = 600;

/** How often to re-check for a step's target while waiting. */
const TARGET_POLL_MS = 50;

/** Below this the sidebar is a drawer, so its items are not on screen. */
const DRAWER_BREAKPOINT_PX = 1024;

/**
 * Below this, a first-login tour is skipped entirely.
 *
 * Two steps is the point at which a walkthrough starts describing a *route*
 * through the product rather than labelling one screen.
 */
const MIN_GENERAL_TOUR_STEPS = 2;

/**
 * Drives the product tour.
 *
 * Owns *what* the tour is doing — which step, whether it is running, how to
 * advance — and nothing about how it looks. `ProductTourComponent` renders it.
 *
 * The step list is derived from the sidebar rather than declared, so a user
 * only ever sees steps for tabs they can actually open, and the total adjusts
 * to match. See `onboarding.config.ts`.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly store = inject(OnboardingStoreService);
  private readonly auth = inject(AuthService);
  private readonly layout = inject(LayoutService);
  private readonly entitlements = inject(EntitlementService);
  private readonly router = inject(Router);

  private readonly status = signal<OnboardingStatus>('not_started');
  private readonly index = signal(0);

  /**
   * Which tour is loaded — **one at a time, always**.
   *
   * Single-active-tour enforcement is this signal existing at all: there is one
   * runner, so starting a tour replaces whatever was in it. Two overlays cannot
   * appear because there is only ever one set of steps to render.
   */
  private readonly tourId = signal<string>(GENERAL_TOUR_ID);

  /**
   * Targets the tour has established are not on this workspace's screen.
   *
   * Filled once, when the tour arrives on its opening route and that page
   * reports itself ready. Steps pointing at them are removed from the list
   * outright rather than skipped one at a time at runtime.
   *
   * This is what keeps the counter honest. Skipping alone leaves "Step 3 of 10"
   * jumping to "Step 8 of 10", which reads as a fault — the user sees five
   * numbers vanish and reasonably concludes the tour broke.
   */
  private readonly hiddenTargets = signal<ReadonlySet<string>>(new Set<string>());

  /** Routes whose absent targets have already been worked out this run. */
  private readonly checkedRoutes = new Set<string>();

  /**
   * Whether the running tour is this user's first-sign-in one.
   *
   * Decides whether finishing it records that they have been onboarded. A
   * module tour opened from Settings must not — reading up on Contacts would
   * otherwise suppress an introduction they never had. A module tour chosen
   * *as* the first-login tour is that introduction, so it must.
   */
  private firstRun = false;

  readonly active = signal(false);
  /** True while navigating and waiting for a target to render. */
  readonly settling = signal(false);
  readonly confirmingSkip = signal(false);

  readonly activeTour = computed<GuidedTour | null>(() => findTour(this.tourId()));

  /** The id of the running tour, or null when nothing is running. */
  readonly runningTourId = computed(() => (this.active() ? this.tourId() : null));

  /** Routes this user's sidebar actually offers. */
  private readonly reachableRoutes = computed(
    () =>
      new Set(
        this.layout
          .visibleNavigation()
          .flatMap((section) => section.items.map((item) => item.route)),
      ),
  );

  /**
   * The steps this user will actually see, for the loaded tour.
   *
   * Configured copy, intersected with the routes their sidebar offers. A step
   * whose route is not reachable is not a step — which keeps the "Step 3 of 8"
   * count honest without anybody maintaining a second list.
   *
   * Note this filters by *route*, not by target. A missing target is handled
   * later, at `moveTo`, because whether an element is on screen depends on
   * state that is only knowable once the page has rendered.
   */
  readonly steps = computed<readonly TourStep[]>(() => {
    const tour = this.activeTour();
    if (tour === null) {
      return [];
    }
    const reachable = this.reachableRoutes();

    const hidden = this.hiddenTargets();

    return tour.steps
      .filter((step) => reachable.has(step.route))
      .filter((step) => step.target === undefined || !hidden.has(step.target))
      .map((step) => ({
        route: step.route,
        // The general tour points at sidebar links, whose `data-tour` is the
        // route. Module tours name an element on the page instead.
        target: step.target ?? step.route,
        title: step.title,
        description: step.description,
      }));
  });

  /**
   * Module tours worth offering this user.
   *
   * Filtered by the same reachability rule as steps: no point listing a
   * WhatsApp tour for a workspace whose plan has no WhatsApp module, or for an
   * employee without permission to open it.
   */
  readonly availableModuleTours = computed<readonly GuidedTour[]>(() => {
    const reachable = this.reachableRoutes();
    return GUIDED_TOURS.filter(
      (tour) =>
        tour.type === 'module' &&
        tour.requiresRoute !== undefined &&
        reachable.has(tour.requiresRoute),
    );
  });

  readonly total = computed(() => this.steps().length);
  readonly stepIndex = computed(() => this.index());
  readonly currentStep = computed<TourStep | null>(() => this.steps()[this.index()] ?? null);
  readonly isFirst = computed(() => this.index() === 0);
  readonly isLast = computed(() => this.index() >= this.total() - 1);

  /** `[data-tour]` selector for the current step's target element. */
  readonly currentSelector = computed(() => {
    const step = this.currentStep();
    return step === null ? null : `[data-tour="${step.target}"]`;
  });

  /* ---------------------------- lifecycle ---------------------------- */

  /**
   * Decides whether a first-time tour should run, and starts it if so.
   *
   * Called once the session and entitlements are known. Deliberately quiet
   * about every reason not to run — this is a nice-to-have that must never
   * stand between a user and their workspace.
   */
  maybeStartForFirstLogin(): void {
    const user = this.auth.user();
    if (user === null || this.active()) {
      return;
    }

    // Super Admins run a different portal with its own navigation; this tour
    // describes the tenant workspace and would be wrong for them.
    if (user.isSuperAdmin) {
      return;
    }

    // A locked workspace has almost no sidebar left, so the tour would be two
    // steps about paying. They get it after they unlock.
    if (this.entitlements.isLocked()) {
      return;
    }

    // Whichever tour actually teaches this user something. See
    // `firstLoginTourId` — for someone granted a single module, the general
    // tour collapses to a one-step overview of it, which is no tour at all.
    this.firstRun = true;
    this.tourId.set(this.firstLoginTourId());

    this.store.getOnboardingStatus(user.id).subscribe((state) => {
      this.status.set(state.status);

      if (state.status === 'completed' || state.status === 'skipped') {
        return;
      }
      // A one-step tour is not a tour.
      //
      // The permission floor grants `dashboard.view` to every invitee, so an
      // employee given nothing else reaches exactly one section — and the
      // general tour collapses to a single card naming the screen they are
      // already looking at. That is noise on someone's first sign-in, and it
      // was reported as such.
      if (this.total() < MIN_GENERAL_TOUR_STEPS) {
        return;
      }

      // `in_progress` means a previous run was interrupted — resume where it
      // stopped rather than starting over.
      //
      // Clamped at both ends. The stored index is only meaningful against the
      // step list that produced it, and that list shrinks when permissions or
      // plan modules change — so an index from a longer list must not run off
      // the end of a shorter one, and a negative must not index before it.
      const resumeAt =
        state.status === 'in_progress'
          ? Math.min(Math.max(0, state.stepIndex), this.total() - 1)
          : 0;

      void this.begin(resumeAt);
    });
  }

  /**
   * Restarts the general tour from the beginning, whatever the stored state
   * says. Kept as its own method because it is the only start that also clears
   * the "already seen" record.
   */
  restart(): void {
    const user = this.auth.user();
    this.stop();
    this.firstRun = false;
    this.tourId.set(GENERAL_TOUR_ID);

    if (user === null || this.total() === 0) {
      return;
    }
    this.store.resetOnboarding(user.id).subscribe(() => void this.begin(0));
  }

  /**
   * The tour to run on a first sign-in.
   *
   * An employee granted one module — WhatsApp, say — reaches one section, so
   * the general tour filters down to a single step describing it. That is a
   * worse introduction than no tour: it names the thing they can already see
   * and stops. The module's own tour teaches them how to use it.
   *
   * The rule is deliberately "exactly one": with two or more sections the map
   * *is* the useful thing, and a detailed tour of one of them would leave the
   * others unexplained. Module tours stay available in Settings either way.
   *
   * Falls back to the general tour when no module tour covers what they have.
   */
  private firstLoginTourId(): string {
    const modules = this.availableModuleTours();
    return modules.length === 1 ? modules[0].id : GENERAL_TOUR_ID;
  }

  /**
   * Starts any registered tour, replacing whatever was running.
   *
   * The replacement is the point: asking for the Contacts tour while the
   * WhatsApp one is open must end the WhatsApp one, not layer a second overlay
   * on top of it. `stop()` first, then load, so there is never a moment with
   * two tours' state in play.
   *
   * Module tours are **not** persisted. They are on-demand help, so "have you
   * seen this" is not a question worth answering — and the requirement that a
   * user can always restart one is satisfied by there being nothing to clear.
   */
  startTour(id: string): void {
    const tour = findTour(id);
    if (tour === null) {
      return;
    }

    if (tour.type === 'general') {
      this.restart();
      return;
    }

    this.stop();
    this.firstRun = false;
    this.tourId.set(id);

    // Every step filtered out — the user cannot reach any of the routes it
    // covers. Silently doing nothing beats an empty overlay.
    if (this.total() === 0) {
      return;
    }
    void this.begin(0);
  }

  /** Ends whatever is running without recording an outcome for it. */
  private stop(): void {
    this.active.set(false);
    this.confirmingSkip.set(false);
    this.index.set(0);
  }

  private async begin(at: number): Promise<void> {
    this.hiddenTargets.set(new Set<string>());
    this.checkedRoutes.clear();

    this.index.set(at);
    this.active.set(true);
    this.persist('in_progress');

    this.settling.set(true);
    try {
      const opened = await this.settleOn(at);

      // Now that the opening page has rendered, work out which of its steps
      // have nothing to point at and drop them, so the count is right from the
      // first step rather than shrinking as the user walks into it.
      //
      // Only when the tour has on-page targets there. The general tour points
      // at sidebar links alone, and waiting on a readiness flag its pages never
      // needed held its first step back for no reason.
      const first = this.steps()[at];
      if (first !== undefined && this.hasPageTargetsOn(first.route)) {
        await this.hideAbsentTargetsOn(first.route);
      }

      if (opened) {
        return;
      }
    } finally {
      this.settling.set(false);
    }

    // The opening step itself had nothing to show. Walk forward rather than
    // opening on an empty spotlight.
    await this.moveTo(at + 1, 1);
  }

  /**
   * Removes steps on `route` whose target is not on screen.
   *
   * Only runs for a page that opts in with `data-tour-ready`, which is how a
   * page says "my data has arrived, what you see is what there is". Without
   * that signal the snapshot could be taken mid-load and hide steps whose
   * targets were merely late — so a page that does not opt in keeps the old
   * behaviour of skipping at runtime.
   */
  private async hideAbsentTargetsOn(route: string): Promise<void> {
    const tour = this.activeTour();
    if (tour === null) {
      return;
    }
    this.checkedRoutes.add(route);

    if (!(await this.waitForPageReady(route))) {
      return;
    }

    const present = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-tour]')].map((element) =>
        element.getAttribute('data-tour'),
      ),
    );

    const hidden = new Set<string>();
    for (const step of tour.steps) {
      if (step.route === route && step.target !== undefined && !present.has(step.target)) {
        hidden.add(step.target);
      }
    }
    // Merged, not replaced: each page is checked once, on arrival, and what an
    // earlier page established still holds.
    this.hiddenTargets.update((previous) => new Set([...previous, ...hidden]));
  }

  private hasPageTargetsOn(route: string): boolean {
    return (this.activeTour()?.steps ?? []).some(
      (step) => step.route === route && step.target !== undefined,
    );
  }

  /** True while the loaded tour is the one whose completion is remembered. */
  private get isGeneralTour(): boolean {
    return this.tourId() === GENERAL_TOUR_ID;
  }

  /* ---------------------------- navigation ---------------------------- */

  async next(): Promise<void> {
    if (this.isLast()) {
      this.complete();
      return;
    }
    await this.moveTo(this.index() + 1, 1);
  }

  async previous(): Promise<void> {
    if (this.isFirst()) {
      return;
    }
    await this.moveTo(this.index() - 1, -1);
  }

  /**
   * Moves to a step, skipping any whose target never appears.
   *
   * `direction` keeps the skip travelling the way the user was going — pressing
   * Back past a missing step must not bounce them forward again. If every
   * remaining step in that direction is unreachable, the tour finishes rather
   * than trapping the user on a dead step.
   */
  private async moveTo(target: number, direction: 1 | -1): Promise<void> {
    let candidate = target;

    this.settling.set(true);
    try {
      while (candidate >= 0 && candidate < this.total()) {
        // Settle **before** committing. Assigning the index first rendered every
        // rejected candidate — title, body and number — for as long as it took
        // to discover it had nothing to point at. A run of four looked exactly
        // like the tour advancing itself through the steps at speed.
        if (await this.settleOn(candidate)) {
          const arrived = this.steps()[candidate];

          // First time on this page: drop its steps that have nothing to point
          // at now, so they cost nothing later instead of a timeout each — and
          // the count is right before this step is shown, not after.
          if (
            arrived !== undefined &&
            !this.checkedRoutes.has(arrived.route) &&
            this.hasPageTargetsOn(arrived.route)
          ) {
            await this.hideAbsentTargetsOn(arrived.route);
            const kept = this.steps().findIndex(
              (step) => step.route === arrived.route && step.target === arrived.target,
            );
            candidate = kept === -1 ? candidate : kept;
          }

          this.index.set(candidate);
          this.persist('in_progress');
          return;
        }
        candidate += direction;
      }
    } finally {
      this.settling.set(false);
    }

    // Ran off the end looking for something to show.
    if (direction === 1) {
      this.complete();
    } else {
      this.active.set(false);
    }
  }

  /**
   * Navigates to a step's route and waits for its target to exist.
   *
   * Returns false when the element never turns up, which is the caller's cue to
   * skip the step. A missing target is not an error — a nav item can disappear
   * mid-tour when entitlements load, and the tour should absorb that.
   */
  private async settleOn(at: number): Promise<boolean> {
    const step = this.steps()[at];
    if (step === undefined) {
      return false;
    }

    try {
      // On a phone the sidebar is a drawer; its links are not in the layout
      // until it is open, so there would be nothing to point at.
      if (this.isDrawerViewport()) {
        this.layout.openMobileNav();
      }

      const selector = `[data-tour="${step.target}"]`;
      const onRoute = this.router.url.split('?')[0].startsWith(step.route);

      // A sidebar step points at a link in the shell, which is on screen
      // whichever page is open. Waiting for the page to load before showing it
      // was the tour's slowness: every Next sat on "Loading…" for the lazy chunk
      // plus the page's data. The page follows behind the spotlight instead.
      if (!onRoute && step.target === step.route && this.isLaidOut(selector)) {
        this.router.navigateByUrl(step.route).catch(() => undefined);
        return true;
      }

      if (!onRoute) {
        await this.router.navigateByUrl(step.route);
      }

      return (await this.waitForTarget(selector, TARGET_TIMEOUT_MS)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Polls for the element until it exists and has been laid out, or the
   * deadline passes.
   *
   * Checks the rect, not just presence: an element can be in the DOM while a
   * transition still has it at zero size, and a zero rect puts the spotlight in
   * the corner of the screen.
   *
   * `setTimeout`, deliberately not `requestAnimationFrame`. Animation frames
   * stop firing in a background tab, which would strand the tour on "Loading…"
   * — and, worse, prevent its own timeout from ever running, since the deadline
   * is only checked inside the callback. Timers keep firing (throttled), so the
   * step still resolves or gives up while the user is looking elsewhere.
   */
  private waitForTarget(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      let deadline = Date.now() + timeoutMs;
      let readySeen = false;

      const attempt = (): void => {
        const element = this.laidOut(selector);
        if (element !== null) {
          // Resolves the moment the element exists — never held back waiting
          // for a readiness flag the page may not even render.
          resolve(element);
          return;
        }

        // Once the page says its data has arrived, a missing target belongs to
        // a state this workspace is not in, so stop waiting for it soon.
        if (!readySeen && document.querySelector('[data-tour-ready]') !== null) {
          readySeen = true;
          deadline = Math.min(deadline, Date.now() + SETTLED_ROUTE_TIMEOUT_MS);
        }

        if (Date.now() > deadline) {
          resolve(null);
          return;
        }
        setTimeout(attempt, TARGET_POLL_MS);
      };

      attempt();
    });
  }

  /**
   * The element, if it is in the DOM and has been laid out.
   *
   * Either dimension, not width alone. A full-width block measures zero width
   * in a collapsed or very narrow viewport while still being on screen, and
   * treating that as "absent" silently skips a real step. `display: none`
   * still yields 0x0, so it is still excluded.
   */
  private laidOut(selector: string): HTMLElement | null {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? element : null;
  }

  private isLaidOut(selector: string): boolean {
    return this.laidOut(selector) !== null;
  }

  /**
   * Waits for the page to say its data has arrived.
   *
   * Presence only — deliberately **not** `waitForTarget`, whose rect check
   * exists so the spotlight is never positioned against a zero-size element.
   * A readiness flag is never spotlit, and applying that check to one silently
   * rejected the marker on a host element that computes to zero width, which
   * is exactly how the filtering came to do nothing at all.
   */
  private waitForPageReady(route: string): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = Date.now() + TARGET_TIMEOUT_MS;
      const attempt = (): void => {
        // The URL check matters now that sidebar steps navigate without
        // waiting: the page being left may carry its own flag, and a snapshot
        // of *that* page would hide every step on the one being opened.
        if (
          this.router.url.split('?')[0].startsWith(route) &&
          document.querySelector('[data-tour-ready]') !== null
        ) {
          resolve(true);
          return;
        }
        if (Date.now() > deadline) {
          resolve(false);
          return;
        }
        setTimeout(attempt, TARGET_POLL_MS);
      };
      attempt();
    });
  }

  private isDrawerViewport(): boolean {
    return window.innerWidth < DRAWER_BREAKPOINT_PX;
  }

  /* ------------------------------ endings ------------------------------ */

  askToSkip(): void {
    this.confirmingSkip.set(true);
  }

  cancelSkip(): void {
    this.confirmingSkip.set(false);
  }

  skip(): void {
    this.confirmingSkip.set(false);
    this.finish('skipped');
  }

  complete(): void {
    this.finish('completed');
  }

  private finish(status: OnboardingStatus): void {
    this.active.set(false);
    this.persist(status);

    if (this.isDrawerViewport()) {
      this.layout.closeMobileNav();
    }
  }

  /**
   * Records progress — **for the general tour only**.
   *
   * The stored state answers one question: has this user had their first-login
   * walkthrough. Writing a module tour's progress into it would answer that
   * question wrongly, and suppress the general tour for someone who had merely
   * opened the Contacts tour from Settings.
   */
  private persist(status: OnboardingStatus): void {
    // The general tour, or whichever tour stood in for it on a first sign-in.
    // Without the second case a module tour chosen as the introduction is
    // never recorded, and reopens on every login.
    if (!this.isGeneralTour && !this.firstRun) {
      return;
    }
    const user = this.auth.user();
    this.status.set(status);
    if (user === null) {
      return;
    }
    this.store.setOnboardingStatus(user.id, status, this.index()).subscribe();
  }
}
