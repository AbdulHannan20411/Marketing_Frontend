import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { TOUR_STEPS } from '@core/config/onboarding.config';
import type { OnboardingStatus, TourStep } from '@core/models/onboarding.model';
import { EntitlementService } from './entitlement.service';
import { LayoutService } from './layout.service';
import { OnboardingStoreService } from './onboarding-store.service';

/** How long to wait for a step's target to appear before giving up on it. */
const TARGET_TIMEOUT_MS = 2500;

/** How often to re-check for a step's target while waiting. */
const TARGET_POLL_MS = 50;

/** Below this the sidebar is a drawer, so its items are not on screen. */
const DRAWER_BREAKPOINT_PX = 1024;

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

  readonly active = signal(false);
  /** True while navigating and waiting for a target to render. */
  readonly settling = signal(false);
  readonly confirmingSkip = signal(false);

  /**
   * The steps this user will actually see.
   *
   * Configured copy, intersected with the routes their sidebar offers. A step
   * whose route is not in the sidebar is not reachable, so it is not a step.
   */
  readonly steps = computed<readonly TourStep[]>(() => {
    const reachable = new Set(
      this.layout.visibleNavigation().flatMap((section) => section.items.map((item) => item.route)),
    );

    return TOUR_STEPS.filter((step) => reachable.has(step.route)).map((step) => ({
      route: step.route,
      title: step.title,
      description: step.description,
    }));
  });

  readonly total = computed(() => this.steps().length);
  readonly stepIndex = computed(() => this.index());
  readonly currentStep = computed<TourStep | null>(() => this.steps()[this.index()] ?? null);
  readonly isFirst = computed(() => this.index() === 0);
  readonly isLast = computed(() => this.index() >= this.total() - 1);

  /** `[data-tour]` value for the current step — the sidebar link's route. */
  readonly currentSelector = computed(() => {
    const step = this.currentStep();
    return step === null ? null : `[data-tour="${step.route}"]`;
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

    this.store.getOnboardingStatus(user.id).subscribe((state) => {
      this.status.set(state.status);

      if (state.status === 'completed' || state.status === 'skipped') {
        return;
      }
      if (this.total() === 0) {
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

  /** Starts the tour from the beginning, whatever the stored state says. */
  restart(): void {
    const user = this.auth.user();
    if (user === null || this.total() === 0) {
      return;
    }
    this.store.resetOnboarding(user.id).subscribe(() => void this.begin(0));
  }

  private async begin(at: number): Promise<void> {
    this.index.set(at);
    this.active.set(true);
    this.persist('in_progress');
    await this.settleOn(at);
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

    while (candidate >= 0 && candidate < this.total()) {
      this.index.set(candidate);
      this.persist('in_progress');

      if (await this.settleOn(candidate)) {
        return;
      }
      candidate += direction;
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

    this.settling.set(true);
    try {
      // On a phone the sidebar is a drawer; its links are not in the layout
      // until it is open, so there would be nothing to point at.
      if (this.isDrawerViewport()) {
        this.layout.openMobileNav();
      }

      if (!this.router.url.split('?')[0].startsWith(step.route)) {
        await this.router.navigateByUrl(step.route);
      }

      return (await this.waitForTarget(`[data-tour="${step.route}"]`)) !== null;
    } catch {
      return false;
    } finally {
      this.settling.set(false);
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
  private waitForTarget(selector: string): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      const deadline = Date.now() + TARGET_TIMEOUT_MS;

      const attempt = (): void => {
        const element = document.querySelector<HTMLElement>(selector);
        if (element !== null && element.getBoundingClientRect().width > 0) {
          resolve(element);
          return;
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

  private persist(status: OnboardingStatus): void {
    const user = this.auth.user();
    this.status.set(status);
    if (user === null) {
      return;
    }
    this.store.setOnboardingStatus(user.id, status, this.index()).subscribe();
  }
}
