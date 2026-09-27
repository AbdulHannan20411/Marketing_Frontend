import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { latestRequest } from '@core/http/latest-request';
import type { LoadState } from '@core/models/api.model';
import type { AuditLogEntry, AuditSeverity } from '@core/models/platform.model';
import { PlatformService } from '@core/services/platform.service';
import { ToastService } from '@core/services/toast.service';
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
import {
  SearchBoxComponent,
  SEARCH_DEBOUNCE_MS,
} from '@shared/ui/search-box/search-box.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const SEVERITY_TONE: Readonly<Record<AuditSeverity, BadgeTone>> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
};

type SeverityFilter = AuditSeverity | 'all';

/** How far back each preset reaches. */
type RangeKey = 'any' | '24h' | '7d' | '30d' | '90d';

const RANGE_DAYS: Readonly<Record<Exclude<RangeKey, 'any'>, number>> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** The ISO instant a range starts at, or null for "any time". */
function since(range: RangeKey): string | null {
  if (range === 'any') {
    return null;
  }
  return new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString();
}



@Component({
  selector: 'app-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SortMenuComponent,
    SearchBoxComponent,
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
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly entries = signal<readonly AuditLogEntry[]>([]);
  protected readonly totalItems = signal(0);
  protected readonly severity = signal<SeverityFilter>('all');
  protected readonly exporting = signal(false);

  /* ------------------------------ filters ------------------------------ */

  protected readonly search = signal('');
  /** Exact actor name, or null for everyone. */
  protected readonly actor = signal<string | null>(null);
  protected readonly range = signal<RangeKey>('any');

  /** Keystrokes, before debouncing: one request per pause, not per letter. */
  private readonly searchInput = new Subject<string>();
  private readonly listRequest = latestRequest();

  protected readonly ranges: readonly { value: RangeKey; label: string }[] = [
    { value: 'any', label: 'Any time' },
    { value: '24h', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
  ];

  /**
   * Who to offer in the picker.
   *
   * Taken from the entries on screen, because there is no endpoint for the
   * platform's distinct actors. That makes it a picker over what is visible
   * rather than over everyone who has ever acted \u2014 useful, and honest about
   * being a shortcut rather than a directory.
   */
  protected readonly actors = computed(() =>
    [...new Set(this.entries().map((entry) => entry.actor))].filter(Boolean).sort(),
  );

  /** The whole filter set, as the API takes it. */
  private readonly filters = computed(() => ({
    search: this.search(),
    actor: this.actor(),
    severity: this.severity() === 'all' ? null : this.severity(),
    from: since(this.range()),
    to: null,
  }));

  protected readonly hasFilters = computed(
    () =>
      this.search().trim() !== '' ||
      this.actor() !== null ||
      this.range() !== 'any' ||
      this.severity() !== 'all',
  );
  protected readonly skeletons = [1, 2, 3, 4, 5, 6, 7, 8];

  protected readonly severityTone = SEVERITY_TONE;

  protected readonly severities: readonly { value: SeverityFilter; label: string }[] = [
    { value: 'all', label: 'All events' },
    { value: 'critical', label: 'Critical' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' },
  ];

  /** The API pages this list; `load()` reads the page and size from here. */
  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
  });

  constructor() {
    this.searchInput
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        this.reload();
      });

    this.load();
  }

  protected onSearch(term: string): void {
    this.searchInput.next(term);
  }

  /**
   * Severity is the API's filter, not a pass over the page.
   *
   * It used to filter `entries()` — the twenty-five rows already on screen —
   * which meant "Critical" showed however many of those happened to be
   * critical while the pager went on reporting thousands. A filter that
   * narrows one page of a paged list is not a filter.
   */
  protected setSeverity(value: SeverityFilter): void {
    this.severity.set(value);
    this.reload();
  }

  protected setActor(value: string): void {
    this.actor.set(value === '' ? null : value);
    this.reload();
  }

  protected setRange(value: RangeKey): void {
    this.range.set(value);
    this.reload();
  }

  protected clearFilters(): void {
    this.searchInput.next('');
    this.search.set('');
    this.actor.set(null);
    this.range.set('any');
    this.severity.set('all');
    this.reload();
  }

  /** Any filter change starts again at page one; page five of the old set is meaningless. */
  private reload(): void {
    this.pager.reset();
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
        this.filters(),
      )
      .pipe(this.listRequest.only())
      .subscribe({
        next: (result) => {
          this.entries.set(result.items);
          this.totalItems.set(result.totalItems);
          this.state.set(result.totalItems === 0 ? 'empty' : 'ready');
        },
        error: () => this.state.set('error'),
      });
  }

  /* ------------------------------- export ------------------------------- */

  /**
   * Downloads what the filters currently select.
   *
   * One request. This used to page the list endpoint a hundred rows at a time
   * and stitch the CSV together here, which meant sixty-eight requests for a
   * sixty-eight page log and a five thousand row ceiling on top. The API
   * streams the file now, applying the same filters and the same sort, so it
   * matches the screen it came from and has no cap.
   */
  protected exportCsv(): void {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(true);

    this.platform
      .exportAuditLogs(this.sorter.key(), this.sorter.direction(), this.filters())
      .subscribe({
        next: () => {
          this.exporting.set(false);
          this.toast.success('Export ready', 'Saved to audit-log.csv.');
        },
        error: () => {
          this.exporting.set(false);
          this.toast.error('Export failed', 'The audit log could not be read. Please try again.');
        },
      });
  }
}
