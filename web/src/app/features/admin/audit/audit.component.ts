import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { LoadState } from '@core/models/api.model';
import type { AuditLogEntry, AuditSeverity } from '@core/models/platform.model';
import { PlatformService } from '@core/services/platform.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { serverSorter } from '@shared/ui/data-table/sort';
import { SortMenuComponent } from '@shared/ui/data-table/sort-menu.component';
import { serverPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const SEVERITY_TONE: Readonly<Record<AuditSeverity, BadgeTone>> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
};

type SeverityFilter = AuditSeverity | 'all';


@Component({
  selector: 'app-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SortMenuComponent,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    AvatarComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    PaginatorComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './audit.component.html',
})
export class AuditComponent {
  private readonly platform = inject(PlatformService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly entries = signal<readonly AuditLogEntry[]>([]);
  protected readonly totalItems = signal(0);
  protected readonly severity = signal<SeverityFilter>('all');
  protected readonly skeletons = [1, 2, 3, 4, 5, 6, 7, 8];

  protected readonly severityTone = SEVERITY_TONE;

  protected readonly severities: readonly { value: SeverityFilter; label: string }[] = [
    { value: 'all', label: 'All events' },
    { value: 'critical', label: 'Critical' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' },
  ];

  protected readonly visibleEntries = computed(() => {
    const filter = this.severity();
    const all = this.entries();
    return filter === 'all' ? all : all.filter((entry) => entry.severity === filter);
  });

  /** The API pages this list; `load()` reads the page and size from here. */
  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
  });

  constructor() {
    this.load();
  }

  /**
   * Ordered by the API.
   *
   * `actor` and `workspace` are joined columns with no index behind them —
   * fine at this size, and the API says so rather than withdrawing the keys.
   * `severity` is derived from the action, so ascending puts the routine
   * entries first and the deletions last.
   */
  protected readonly sorter = serverSorter({
    columns: [
      { key: 'occurredAt', label: 'When', initialDirection: 'desc' },
      { key: 'actor', label: 'Who' },
      { key: 'action', label: 'Action' },
      { key: 'severity', label: 'Severity', initialDirection: 'desc' },
      { key: 'workspace', label: 'Workspace' },
      { key: 'entity', label: 'Record' },
    ],
    load: () => {
      this.pager.reset();
      this.load();
    },
  });

  protected load(): void {
    this.state.set('loading');
    this.platform
      .listAuditLogs(
        this.pager.page(),
        this.pager.pageSize(),
        this.sorter.key(),
        this.sorter.direction(),
      )
      .subscribe({
      next: (result) => {
        this.entries.set(result.items);
        this.totalItems.set(result.totalItems);
        this.state.set(result.totalItems === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

}
