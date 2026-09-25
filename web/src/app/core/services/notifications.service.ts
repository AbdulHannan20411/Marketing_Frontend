import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type { ApiError } from '@core/models/api.model';
import { categoryOfNotification } from '@core/models/notification-category.model';
import type {
  AppNotification,
  AppNotificationDto,
  NotificationClearScope,
  NotificationDeleteResult,
} from '@core/models/notification.model';
import { toNotification } from '@core/models/notification.model';
import { ApiService } from './api.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { RealtimeService } from './realtime.service';
import { ToastService } from './toast.service';

/**
 * Holds the notification list in a signal so the topbar badge, dropdown and
 * full-page center all read the same state without refetching.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiService);
  private readonly realtime = inject(RealtimeService);
  private readonly prefs = inject(NotificationPreferencesService);
  private readonly toast = inject(ToastService);

  /** Everything the server has sent, before the user's switches are applied. */
  private readonly items = signal<readonly AppNotification[]>([]);
  private readonly loading = signal(false);
  /** A read is out; a second `load()` would only duplicate it. */
  private inFlight = false;

  /**
   * What the user asked to see.
   *
   * Filtered here rather than at load, so switching a category off in Settings
   * empties it from the bell and the list at once — and switching it back on
   * brings back what arrived meanwhile without a refetch. The server should
   * not send a silenced notification at all; this covers an API that predates
   * preferences, and a push that raced a change.
   */
  readonly notifications = computed(() =>
    this.items().filter((notification) => this.prefs.isEnabled(categoryOfNotification(notification))),
  );
  readonly isLoading = this.loading.asReadonly();

  readonly unreadCount = computed(
    () => this.notifications().filter((notification) => !notification.read).length,
  );

  /**
   * Everything the user actually has, switches ignored.
   *
   * The clear dialog counts with these rather than with the visible list: the
   * server deletes by scope, so "Delete all (12)" has to mean twelve, not the
   * nine left after a silenced category is filtered out of the screen.
   */
  readonly count = computed(() => this.items().length);
  readonly readCount = computed(
    () => this.items().filter((notification) => notification.read).length,
  );

  readonly hasCritical = computed(() =>
    this.notifications().some(
      (notification) => !notification.read && notification.priority === 'critical',
    ),
  );

  /**
   * Reads the list.
   *
   * **Only the first read shows skeletons.** A refetch — after a reconnect,
   * say — keeps what is on screen and replaces it when the answer arrives.
   * Swapping a list somebody is reading for skeletons and back is what reads
   * as the page blinking, and with a hub that reconnects repeatedly it did
   * exactly that every few seconds.
   */
  load(): void {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    if (this.items().length === 0) {
      this.loading.set(true);
    }

    this.api.get<readonly AppNotificationDto[]>('/notifications').subscribe({
      next: (notifications) => {
        this.items.set(notifications.map(toNotification));
        this.inFlight = false;
        this.loading.set(false);
      },
      error: () => {
        this.inFlight = false;
        this.loading.set(false);
      },
    });
  }

  markRead(id: string): void {
    // Optimistic: the badge should drop the moment the user opens an item.
    this.items.update((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    );
    // The server returns the full list; taking it keeps this in step with
    // anything that changed elsewhere rather than trusting the local edit.
    this.api
      .post<readonly AppNotificationDto[]>(`/notifications/${id}/read`)
      .subscribe({
        next: (notifications) => this.items.set(notifications.map(toNotification)),
        // The optimistic update above already showed it as read. A failed
        // write is not worth undoing that in front of the user.
        error: () => undefined,
      });
  }

  constructor() {
    // The hub was already emitting these and nothing was listening, so a
    // pushed notification only ever appeared on the next page load — which
    // looks identical to no notification at all.
    this.realtime.notifications$
      .pipe(takeUntilDestroyed())
      .subscribe((notification) => this.receive(notification));

    // Events are not replayed, so a reconnect has to refetch or the bell keeps
    // showing whatever it had before the connection dropped.
    this.realtime.resynced$.pipe(takeUntilDestroyed()).subscribe(() => this.load());
  }

  /** Adds a pushed notification, newest first, without duplicating a resend. */
  private receive(notification: AppNotification): void {
    this.items.update((current) => {
      const index = current.findIndex((entry) => entry.id === notification.id);
      if (index === -1) {
        return [notification, ...current];
      }
      const next = [...current];
      next[index] = notification;
      return next;
    });
  }

  markAllRead(): void {
    this.items.update((current) =>
      current.map((notification) => ({ ...notification, read: true })),
    );
    this.api.post<readonly AppNotificationDto[]>('/notifications/read-all').subscribe({
      next: (notifications) => this.items.set(notifications.map(toNotification)),
      error: () => undefined,
    });
  }

  /* ---------------------------------------------------------------- *
   * Deleting
   *
   * All three are optimistic **and roll back**, which is the opposite of
   * `markRead` above — deliberately. A read flag that fails to save is a
   * briefly wrong badge. A delete that fails leaves the row gone from the
   * screen and present on the server, so it walks back in on the next load
   * and the app looks like it lost track of itself. Put it back, and say so.
   * ---------------------------------------------------------------- */

  /** Deletes one notification. */
  remove(id: string): void {
    const previous = this.items();
    this.items.update((current) => current.filter((notification) => notification.id !== id));

    this.api
      .delete<NotificationDeleteResult>(`/notifications/${encodeURIComponent(id)}`)
      .subscribe({
        // 404 is not a failure here: the row is gone, which is what was asked
        // for. It happens whenever the same notification is deleted twice —
        // from the bell and from the page, or from two open tabs.
        error: (error: ApiError) => {
          if (error.status !== 404) {
            this.rollback(previous, 'That notification could not be deleted.');
          }
        },
      });
  }

  /** Deletes the ones the user ticked. */
  removeMany(ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }
    const previous = this.items();
    const doomed = new Set(ids);
    this.items.update((current) => current.filter((notification) => !doomed.has(notification.id)));

    this.api
      .post<NotificationDeleteResult, { readonly ids: readonly string[] }>(
        '/notifications/delete',
        { ids },
      )
      .subscribe({
        next: (result) => this.toast.success(deletedLabel(result?.deleted ?? ids.length)),
        error: () =>
          this.rollback(
            previous,
            ids.length === 1
              ? 'That notification could not be deleted.'
              : 'Those notifications could not be deleted.',
          ),
      });
  }

  /**
   * Deletes everything, or everything already read.
   *
   * The scope is sent rather than a list of ids: the user means "all of them",
   * including any that arrived since the page loaded and any the client never
   * held. Sending ids would quietly leave those behind.
   */
  clear(scope: NotificationClearScope): void {
    const previous = this.items();
    this.items.update((current) =>
      scope === 'read' ? current.filter((notification) => !notification.read) : [],
    );

    this.api
      .post<NotificationDeleteResult, { readonly scope: NotificationClearScope }>(
        '/notifications/delete',
        { scope },
      )
      .subscribe({
        next: (result) => this.toast.success(deletedLabel(result?.deleted ?? previous.length)),
        error: () => this.rollback(previous, 'Your notifications could not be deleted.'),
      });
  }

  /**
   * Puts back what a failed delete removed.
   *
   * Merged rather than assigned: a pushed notification can land between the
   * optimistic removal and the failure, and restoring a snapshot wholesale
   * would throw that one away.
   */
  private rollback(previous: readonly AppNotification[], message: string): void {
    this.items.update((current) => {
      const present = new Set(current.map((notification) => notification.id));
      const restored = previous.filter((notification) => !present.has(notification.id));
      return restored.length === 0
        ? current
        : [...current, ...restored].sort(
            (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
          );
    });
    this.toast.error('Not deleted', message);
  }
}

function deletedLabel(count: number): string {
  return count === 1 ? '1 notification deleted' : `${count} notifications deleted`;
}
