import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import type { AppNotification, NotificationPriority } from '@core/models/notification.model';
import { NotificationsService } from '@core/services/notifications.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';

type ReadFilter = 'all' | 'unread' | 'read';
type PriorityFilter = NotificationPriority | 'all';

const PRIORITY_TONE: Readonly<Record<NotificationPriority, BadgeTone>> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
  success: 'success',
};

@Component({
  selector: 'app-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
  ],
  templateUrl: './notifications.component.html',
})
export class NotificationsComponent {
  private readonly notificationsService = inject(NotificationsService);
  private readonly router = inject(Router);

  protected readonly readFilter = signal<ReadFilter>('all');
  protected readonly priorityFilter = signal<PriorityFilter>('all');
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];

  protected readonly priorityTone = PRIORITY_TONE;
  protected readonly isLoading = this.notificationsService.isLoading;
  protected readonly unreadCount = this.notificationsService.unreadCount;

  protected readonly readFilters: readonly { value: ReadFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'unread', label: 'Unread' },
    { value: 'read', label: 'Read' },
  ];

  protected readonly priorityFilters: readonly { value: PriorityFilter; label: string }[] = [
    { value: 'all', label: 'Any priority' },
    { value: 'critical', label: 'Critical' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' },
    { value: 'success', label: 'Success' },
  ];

  private readonly sorted = computed(() =>
    [...this.notificationsService.notifications()].sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
    ),
  );

  protected readonly visible = computed(() => {
    const read = this.readFilter();
    const priority = this.priorityFilter();

    return this.sorted().filter((notification) => {
      const matchesRead =
        read === 'all' || (read === 'unread' ? !notification.read : notification.read);
      const matchesPriority = priority === 'all' || notification.priority === priority;
      return matchesRead && matchesPriority;
    });
  });

  protected readonly criticalCount = computed(
    () => this.sorted().filter((n) => n.priority === 'critical' && !n.read).length,
  );

  constructor() {
    this.notificationsService.load();
  }

  protected open(notification: AppNotification): void {
    this.notificationsService.markRead(notification.id);
    if (notification.actionRoute !== null) {
      void this.router.navigateByUrl(notification.actionRoute);
    }
  }

  protected markRead(event: Event, notification: AppNotification): void {
    // Stop the row's own click handler from also navigating away.
    event.stopPropagation();
    this.notificationsService.markRead(notification.id);
  }

  protected markAllRead(): void {
    this.notificationsService.markAllRead();
  }

  protected clearFilters(): void {
    this.readFilter.set('all');
    this.priorityFilter.set('all');
  }
}
