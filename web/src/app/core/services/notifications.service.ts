import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type { AppNotification, AppNotificationDto } from '@core/models/notification.model';
import { toNotification } from '@core/models/notification.model';
import { ApiService } from './api.service';
import { RealtimeService } from './realtime.service';

/**
 * Holds the notification list in a signal so the topbar badge, dropdown and
 * full-page center all read the same state without refetching.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiService);
  private readonly realtime = inject(RealtimeService);

  private readonly items = signal<readonly AppNotification[]>([]);
  private readonly loading = signal(false);

  readonly notifications = this.items.asReadonly();
  readonly isLoading = this.loading.asReadonly();

  readonly unreadCount = computed(
    () => this.items().filter((notification) => !notification.read).length,
  );

  readonly hasCritical = computed(() =>
    this.items().some((notification) => !notification.read && notification.priority === 'critical'),
  );

  load(): void {
    if (this.loading()) {
      return;
    }
    this.loading.set(true);

    this.api.get<readonly AppNotificationDto[]>('/notifications').subscribe({
      next: (notifications) => {
        this.items.set(notifications.map(toNotification));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
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
}
