import { Injectable, computed, inject, signal } from '@angular/core';
import { map, tap, type Observable } from 'rxjs';

import type { ApiError } from '@core/models/api.model';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isAlwaysOn,
  toPreferences,
  type NotificationCategory,
  type NotificationPreferences,
} from '@core/models/notification-category.model';
import { ApiService } from './api.service';

const BASE = '/notifications/preferences';

/**
 * Which kinds of notification this user wants.
 *
 * Held in a signal because three places read it: the Settings switches, the
 * notification list, and the service that receives pushed ones. Loaded once per
 * sign-in — a 404 or a failure leaves everything on, because the safe default
 * for "we don't know what you wanted" is to tell you.
 *
 * **The server is the one that must honour it**, by not sending a suppressed
 * notification at all. This also filters what arrives, which covers an API that
 * does not know about preferences yet and a push that races a change here.
 */
@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private readonly api = inject(ApiService);

  private readonly state = signal<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  private readonly loaded = signal(false);
  private readonly saving = signal(false);
  /** True when the API has no preferences endpoint, so Settings can say so. */
  private readonly unsupported = signal(false);

  readonly preferences = this.state.asReadonly();
  readonly isLoaded = this.loaded.asReadonly();
  readonly isSaving = this.saving.asReadonly();
  readonly isUnsupported = this.unsupported.asReadonly();

  readonly silencedCount = computed(
    () => Object.values(this.state()).filter((enabled) => !enabled).length,
  );

  load(): void {
    this.api.get<Partial<Record<string, unknown>>>(BASE).subscribe({
      next: (raw) => {
        this.state.set(toPreferences(raw));
        this.loaded.set(true);
        this.unsupported.set(false);
      },
      error: (error: ApiError) => {
        // Everything stays on: silence is never the default.
        this.state.set(DEFAULT_NOTIFICATION_PREFERENCES);
        this.loaded.set(true);
        this.unsupported.set(error.status === 404);
      },
    });
  }

  isEnabled(category: NotificationCategory): boolean {
    return isAlwaysOn(category) || this.state()[category];
  }

  /**
   * Switches one category on or off. Applied locally first so the switch
   * responds at once, and rolled back if the server refuses.
   */
  set(category: NotificationCategory, enabled: boolean): Observable<NotificationPreferences> {
    if (isAlwaysOn(category)) {
      throw new Error(`${category} notifications cannot be switched off.`);
    }
    const previous = this.state();
    const next = { ...previous, [category]: enabled };
    this.state.set(next);
    this.saving.set(true);

    return this.api.put<Partial<Record<string, unknown>>, NotificationPreferences>(BASE, next).pipe(
      tap({
        error: () => {
          this.state.set(previous);
          this.saving.set(false);
        },
      }),
      // The server's copy wins, so another device's change shows up here.
      map((raw) => {
        const saved = toPreferences(raw);
        this.state.set(saved);
        this.saving.set(false);
        return saved;
      }),
    );
  }
}
