import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';

import type { DashboardSnapshot } from '@core/models/analytics.model';
import type { DeliveryFailure } from '@core/models/campaign.model';
import type { ApiError, LoadState } from '@core/models/api.model';
import { DashboardService } from '@core/services/dashboard.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { ChartComponent } from '@shared/ui/chart/chart.component';
import { areaTrendChart, funnelChart } from '@shared/ui/chart/chart.presets';
import { DataTableComponent, type TableColumn } from '@shared/ui/data-table/data-table.component';
import { TableRowDirective } from '@shared/ui/data-table/table-row.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { serverPager } from '@shared/ui/pagination/pager';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { StatCardComponent } from '@shared/ui/stat-card/stat-card.component';



@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    ChartComponent,
    DataTableComponent,
    TableRowDirective,
    StatCardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
  ],
  templateUrl: './reports.component.html',
})
export class ReportsComponent {
  private readonly dashboardService = inject(DashboardService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly snapshot = signal<DashboardSnapshot | null>(null);
  protected readonly failures = signal<readonly DeliveryFailure[]>([]);
  protected readonly failureTotal = signal(0);
  protected readonly failureState = signal<LoadState>('loading');

  /** The API pages delivery failures; `loadFailures()` reads from here. */
  protected readonly failurePager = serverPager({
    total: this.failureTotal,
    load: () => this.loadFailures(),
  });

  protected readonly columns: readonly TableColumn[] = [
    { key: 'contact', header: 'Recipient' },
    { key: 'campaign', header: 'Campaign', hideOnMobile: true },
    { key: 'reason', header: 'Reason' },
    { key: 'code', header: 'Code', align: 'right', hideOnMobile: true },
    { key: 'when', header: 'When', align: 'right', hideOnMobile: true },
  ];

  protected readonly kpis = computed(() => this.snapshot()?.kpis ?? null);

  /**
   * Whether there is anything to calculate a rate from.
   *
   * Every headline here is a ratio of the counters in `kpis`. With no sends
   * counted there is no denominator, and "0.0%" would be a claim rather than a
   * reading.
   */
  protected readonly hasVolume = computed(() => (this.kpis()?.messagesSent ?? 0) > 0);

  /**
   * The counters say nothing was sent, and the failure log disagrees.
   *
   * Both come from the same API, so one of them is wrong — and the failure log
   * is the one with evidence in it. Saying so beats showing a 0.00% failure
   * rate above a list of failures, which is what this page did.
   */
  protected readonly metricsMissing = computed(
    () => this.state() === 'ready' && !this.hasVolume() && this.failureTotal() > 0,
  );

  /** Something other than a flat line at zero. */
  protected readonly hasTrend = computed(() =>
    (this.snapshot()?.trend ?? []).some((point) => point.sent + point.delivered + point.read > 0),
  );

  protected readonly hasFunnel = computed(() =>
    (this.snapshot()?.funnel ?? []).some((stage) => stage.value > 0),
  );

  protected readonly deliveryRate = computed(() => {
    const kpis = this.kpis();
    if (kpis === null || kpis.messagesSent === 0) {
      return 0;
    }
    return Number(((kpis.delivered / kpis.messagesSent) * 100).toFixed(1));
  });

  protected readonly readRate = computed(() => {
    const kpis = this.kpis();
    if (kpis === null || kpis.delivered === 0) {
      return 0;
    }
    return Number(((kpis.read / kpis.delivered) * 100).toFixed(1));
  });

  protected readonly failureRate = computed(() => {
    const kpis = this.kpis();
    if (kpis === null || kpis.messagesSent === 0) {
      return 0;
    }
    return Number(((kpis.failed / kpis.messagesSent) * 100).toFixed(2));
  });

  protected readonly trendOptions = computed(() => {
    const trend = this.snapshot()?.trend ?? [];
    return areaTrendChart({
      categories: trend.map((point) =>
        new Date(point.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      ),
      sent: trend.map((point) => point.sent),
      delivered: trend.map((point) => point.delivered),
      read: trend.map((point) => point.read),
    });
  });

  protected readonly funnelOptions = computed(() => {
    const funnel = this.snapshot()?.funnel ?? [];
    return funnelChart({
      labels: funnel.map((stage) => stage.label),
      values: funnel.map((stage) => stage.value),
    });
  });

  /** Failure reasons ranked by frequency, for the breakdown list. */
  protected readonly failureBreakdown = computed(() => {
    const counts = new Map<string, number>();
    for (const failure of this.failures()) {
      counts.set(failure.reason, (counts.get(failure.reason) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return [...counts.entries()]
      .map(([reason, count]) => ({ reason, count, percent: Math.round((count / max) * 100) }))
      .sort((a, b) => b.count - a.count);
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.failureState.set('loading');

    forkJoin({
      snapshot: this.dashboardService.getReportsOverview(),
      failures: this.dashboardService.getFailures(this.failurePager.page(), this.failurePager.pageSize()),
    }).subscribe({
      next: ({ snapshot, failures }) => {
        this.snapshot.set(snapshot);
        this.failures.set(failures.items);
        this.failureTotal.set(failures.totalItems);
        this.state.set('ready');
        this.failureState.set(failures.totalItems === 0 ? 'empty' : 'ready');
      },
      error: () => {
        this.state.set('error');
        this.failureState.set('error');
      },
    });
  }

  private loadFailures(): void {
    this.failureState.set('loading');

    this.dashboardService.getFailures(this.failurePager.page(), this.failurePager.pageSize()).subscribe({
      next: (result) => {
        this.failures.set(result.items);
        this.failureTotal.set(result.totalItems);
        this.failureState.set('ready');
      },
      error: () => this.failureState.set('error'),
    });
  }

  protected readonly exporting = signal(false);

  /**
   * Downloads the failure log.
   *
   * This used to show a toast claiming the export had been queued and would be
   * emailed. Nothing was queued and no email was ever sent — the button had no
   * implementation behind it at all, which is worse than a disabled control
   * because it reports success.
   */
  protected exportCsv(): void {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(true);

    this.dashboardService.exportFailures().subscribe({
      next: () => {
        this.exporting.set(false);
        this.toast.success('Export ready', 'The failure log has been downloaded.');
      },
      error: (error: ApiError) => {
        this.exporting.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
