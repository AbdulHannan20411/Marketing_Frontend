import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_COPY,
  categoryOfNotification,
  type NotificationCategory,
} from '@core/models/notification-category.model';
import type {
  AppNotification,
  NotificationClearScope,
  NotificationPriority,
} from '@core/models/notification.model';
import { NotificationPreferencesService } from '@core/services/notification-preferences.service';
import { NotificationsService } from '@core/services/notifications.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
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
    ModalComponent,
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

  /**
   * Ticked rows, by id.
   *
   * Ids rather than whole rows, so a row that changes underneath — a push
   * marking it read — stays ticked, and one that is deleted drops out of
   * {@link selectedIds} on its own.
   */
  private readonly ticked = signal<ReadonlySet<string>>(new Set<string>());

  /** Which delete is waiting on a confirmation, if any. */
  protected readonly confirming = signal<'selected' | 'clear' | null>(null);

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

  /**
   * The ticked rows that are still on screen.
   *
   * Intersected with the filtered list, not the whole one, so a delete can
   * only ever take rows the user can actually see — ticking twenty, then
   * filtering down to three, deletes those three. It also means a deleted or
   * silenced row leaves the selection without anything having to prune it.
   */
  protected readonly selectedIds = computed(() => {
    const ticked = this.ticked();
    return this.visible()
      .filter((notification) => ticked.has(notification.id))
      .map((notification) => notification.id);
  });

  protected readonly selectedCount = computed(() => this.selectedIds().length);

  protected readonly allSelected = computed(() => {
    const rows = this.visible();
    return rows.length > 0 && this.selectedCount() === rows.length;
  });

  /** For the clear dialog, which deletes by scope rather than by what is on screen. */
  protected readonly readCount = this.notificationsService.readCount;
  protected readonly totalCount = this.notificationsService.count;

  /** One page of notifications; the list grows without bound over time. */
  protected readonly pager = clientPager(this.visible);

  /** Every row of the current page ticked, for the section header's box. */
  protected sectionSelected(section: NotificationSection): boolean {
    const ticked = this.ticked();
    return section.items.every((notification) => ticked.has(notification.id));
  }

  protected isSelected(id: string): boolean {
    return this.ticked().has(id);
  }

  protected toggleRow(event: Event, notification: AppNotification): void {
    // The row itself opens the notification; ticking it must not.
    event.stopPropagation();
    this.ticked.update((current) => {
      const next = new Set(current);
      if (!next.delete(notification.id)) {
        next.add(notification.id);
      }
      return next;
    });
  }

  protected toggleSection(section: NotificationSection): void {
    const select = !this.sectionSelected(section);
    this.ticked.update((current) => {
      const next = new Set(current);
      for (const notification of section.items) {
        if (select) {
          next.add(notification.id);
        } else {
          next.delete(notification.id);
        }
      }
      return next;
    });
  }

  /** Ticks everything the filters allow, across pages — not just this one. */
  protected toggleAll(): void {
    if (this.allSelected()) {
      this.clearSelection();
      return;
    }
    this.ticked.set(new Set(this.visible().map((notification) => notification.id)));
  }

  protected clearSelection(): void {
    this.ticked.set(new Set<string>());
  }

  protected askDeleteSelected(): void {
    this.confirming.set('selected');
  }

  protected askClear(): void {
    this.confirming.set('clear');
  }

  protected cancelDelete(): void {
    this.confirming.set(null);
  }

  protected deleteOne(event: Event, notification: AppNotification): void {
    // Deleting one row is undoable in the sense that matters: nothing else
    // changes, and the row said what it said. A dialog for it would be a
    // click in the way of the clean-up people do most often.
    event.stopPropagation();
    this.notificationsService.remove(notification.id);
  }

  protected deleteSelected(): void {
    this.notificationsService.removeMany(this.selectedIds());
    this.clearSelection();
    this.confirming.set(null);
  }

  protected clear(scope: NotificationClearScope): void {
    this.notificationsService.clear(scope);
    this.clearSelection();
    this.confirming.set(null);
  }

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
