import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_COPY,
  categoryOfNotification,
  type NotificationCategory,
} from '@core/models/notification-category.model';
import type { AppNotification, NotificationPriority } from '@core/models/notification.model';
import { NotificationPreferencesService } from '@core/services/notification-preferences.service';
import { NotificationsService } from '@core/services/notifications.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { clientPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';

type ReadFilter = 'all' | 'unread' | 'read';
type CategoryFilter = NotificationCategory | 'all';

/** One heading and its notifications, for the grouped list. */
export interface NotificationSection {
  readonly category: NotificationCategory;
  readonly label: string;
  readonly description: string;
  readonly items: readonly AppNotification[];
  readonly unread: number;
}
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
    RouterLink,
    PaginatorComponent,
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

  private readonly prefs = inject(NotificationPreferencesService);

  protected readonly readFilter = signal<ReadFilter>('all');
  protected readonly priorityFilter = signal<PriorityFilter>('all');
  protected readonly categoryFilter = signal<CategoryFilter>('all');
  protected readonly categoryCopy = NOTIFICATION_CATEGORY_COPY;
  protected readonly silencedCount = this.prefs.silencedCount;
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
    const category = this.categoryFilter();

    return this.sorted().filter((notification) => {
      const matchesRead =
        read === 'all' || (read === 'unread' ? !notification.read : notification.read);
      const matchesPriority = priority === 'all' || notification.priority === priority;
      const matchesCategory = category === 'all' || categoryOfNotification(notification) === category;
      return matchesRead && matchesPriority && matchesCategory;
    });
  });

  /**
   * The page, in sections by what the notification is about.
   *
   * Grouping the *page* rather than the whole list keeps the two honest
   * together: the sections describe exactly the rows on screen, so the counts
   * in a heading always match what is under it.
   */
  protected readonly sections = computed<readonly NotificationSection[]>(() => {
    const onPage = this.pager.items();
    return NOTIFICATION_CATEGORIES.map((category) => {
      const items = onPage.filter((notification) => categoryOfNotification(notification) === category);
      const copy = NOTIFICATION_CATEGORY_COPY[category];
      return {
        category,
        label: copy.label,
        description: copy.description,
        items,
        unread: items.filter((notification) => !notification.read).length,
      };
    }).filter((section) => section.items.length > 0);
  });

  /** Counts across everything, so a tab shows what it would show if chosen. */
  protected readonly categoryTabs = computed(() => {
    const all = this.sorted();
    const tabs = NOTIFICATION_CATEGORIES.filter((category) =>
      all.some((notification) => categoryOfNotification(notification) === category),
    ).map((category) => ({
      value: category as CategoryFilter,
      label: NOTIFICATION_CATEGORY_COPY[category].label,
      count: all.filter((notification) => categoryOfNotification(notification) === category).length,
    }));
    return [{ value: 'all' as CategoryFilter, label: 'Everything', count: all.length }, ...tabs];
  });

  /** One page of notifications; the list grows without bound over time. */
  protected readonly pager = clientPager(this.visible);

  protected setReadFilter(value: ReadFilter): void {
    this.readFilter.set(value);
    this.pager.reset();
  }

  protected setPriorityFilter(value: PriorityFilter): void {
    this.priorityFilter.set(value);
    this.pager.reset();
  }

  protected setCategoryFilter(value: CategoryFilter): void {
    this.categoryFilter.set(value);
    this.pager.reset();
  }

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
    this.categoryFilter.set('all');
    this.pager.reset();
  }
}
