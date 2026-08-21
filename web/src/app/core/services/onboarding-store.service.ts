import { Injectable, inject } from '@angular/core';
import { catchError, map, of, type Observable } from 'rxjs';

import type { OnboardingState, OnboardingStatus } from '@core/models/onboarding.model';
import { INITIAL_ONBOARDING_STATE } from '@core/models/onboarding.model';
import { ApiService } from './api.service';

/**
 * Where onboarding state lives.
 *
 * **The single seam between the tour and its storage.** No component and no
 * other service reads `localStorage` for this — swapping to the API is a change
 * to the three methods below and nothing else.
 *
 * `GET`/`PUT /auth/me/onboarding` are **built but not yet migrated** — the
 * columns do not exist on the server yet, so both fail today. Until the backend
 * confirms the migration has run, every read and write goes to `localStorage`;
 * see `useApi` below.
 *
 * State is keyed **per user**. Two people sharing a browser must not inherit
 * each other's tour, and signing out and back in as someone else must not
 * suppress their first-run experience.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingStoreService {
  private readonly api = inject(ApiService);

  /**
   * Flip to `true` once the backend confirms the migration has been applied.
   *
   * **Not yet.** The endpoints are written but their columns are not, so
   * turning this on now would fail every read and write.
   *
   * Kept as an explicit switch rather than feature-detection: a failure on
   * every page load, swallowed into a fallback, is the kind of thing that hides
   * a genuine outage. The local path stays afterwards as the `catchError`
   * fallback, so a first run still works offline.
   */
  private readonly useApi = false;

  private key(userId: string): string {
    return `vd.onboarding.${userId}`;
  }

  /**
   * Reads the stored state, falling back to `not_started`.
   *
   * Never throws: a corrupt entry, a browser with storage disabled, or a schema
   * that has since changed all degrade to "this user has not seen the tour",
   * which is the safe default — showing it twice is a smaller failure than
   * crashing the shell on load.
   */
  getOnboardingStatus(userId: string): Observable<OnboardingState> {
    if (this.useApi) {
      return this.api
        .get<OnboardingState>('/auth/me/onboarding')
        .pipe(catchError(() => of(this.readLocal(userId))));
    }
    return of(this.readLocal(userId));
  }

  setOnboardingStatus(
    userId: string,
    status: OnboardingStatus,
    stepIndex: number,
  ): Observable<OnboardingState> {
    const next: OnboardingState = { status, stepIndex, updatedAt: new Date().toISOString() };

    if (this.useApi) {
      return this.api
        .put<OnboardingState, OnboardingState>('/auth/me/onboarding', next)
        .pipe(catchError(() => of(this.writeLocal(userId, next))));
    }
    return of(this.writeLocal(userId, next));
  }

  /** Back to `not_started`, so the tour runs again from the beginning. */
  resetOnboarding(userId: string): Observable<OnboardingState> {
    return this.setOnboardingStatus(userId, 'not_started', 0).pipe(map((state) => state));
  }

  /* ------------------------------ local ------------------------------ */

  private readLocal(userId: string): OnboardingState {
    try {
      const raw = localStorage.getItem(this.key(userId));
      if (raw === null) {
        return INITIAL_ONBOARDING_STATE;
      }

      const parsed = JSON.parse(raw) as Partial<OnboardingState>;
      const status = parsed.status;
      if (
        status !== 'not_started' &&
        status !== 'in_progress' &&
        status !== 'completed' &&
        status !== 'skipped'
      ) {
        return INITIAL_ONBOARDING_STATE;
      }

      return {
        status,
        // Clamped, not trusted. The API clamps a negative index server-side for
        // the same reason: a negative would index before the start of the step
        // list and leave the tour running with no step to show.
        stepIndex: Number.isFinite(parsed.stepIndex) ? Math.max(0, Number(parsed.stepIndex)) : 0,
        updatedAt: parsed.updatedAt ?? null,
      };
    } catch {
      return INITIAL_ONBOARDING_STATE;
    }
  }

  private writeLocal(userId: string, state: OnboardingState): OnboardingState {
    try {
      localStorage.setItem(this.key(userId), JSON.stringify(state));
    } catch {
      // Private browsing, or storage full. The tour still runs for this session;
      // it simply will not be remembered, which is preferable to failing the
      // action the user just took.
    }
    return state;
  }
}
