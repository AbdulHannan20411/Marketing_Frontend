import { Injectable, computed, inject, signal } from '@angular/core';

import type { AppNotification } from '@core/models/notification.model';
import { ApiService } from './api.service';

/**
 * Holds the notification list in a signal so the topbar badge, dropdown and
 * full-page center all read the same state without refetching.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiService);

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

    this.api.get<readonly AppNotification[]>('/notifications').subscribe({
      next: (notifications) => {
        this.items.set(notifications);
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
    this.api.post<readonly AppNotification[]>(`/notifications/${id}/read`).subscribe();
  }

  markAllRead(): void {
    this.items.update((current) =>
      current.map((notification) => ({ ...notification, read: true })),
    );
    this.api.post<readonly AppNotification[]>('/notifications/read-all').subscribe();
  }
}
