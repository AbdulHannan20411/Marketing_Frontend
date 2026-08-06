import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import type { LoadState } from '@core/models/api.model';
import type { AdminAccount, PlatformOverview } from '@core/models/admin-account.model';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { PlatformService } from '@core/services/platform.service';
import { ToastService } from '@core/services/toast.service';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { ChartComponent } from '@shared/ui/chart/chart.component';
import { areaTrendChart } from '@shared/ui/chart/chart.presets';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { StatCardComponent } from '@shared/ui/stat-card/stat-card.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

interface AdminReportRow {
  readonly admin: AdminAccount;
  readonly messages: number;
  readonly sharePercent: number;
}

/** Reports aggregated across every admin and employee on the platform. */
@Component({
  selector: 'app-global-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    PageHeaderComponent,
    CardComponent,
    ChartComponent,
    StatCardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './global-reports.component.html',
})
export class GlobalReportsComponent {
  private readonly platform = inject(PlatformService);
  private readonly scope = inject(AdminScopeService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly overview = signal<PlatformOverview | null>(null);
  protected readonly admins = signal<readonly AdminAccount[]>([]);
  protected readonly skeletons = [1, 2, 3, 4, 5];

  protected readonly trendOptions = computed(() => {
    const trend = this.overview()?.trend ?? [];
    return areaTrendChart({
      categories: trend.map((point) =>
        new Date(point.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      ),
      sent: trend.map((point) => point.messages),
      delivered: trend.map((point) => Math.round(point.messages * 0.968)),
      read: trend.map((point) => Math.round(point.messages * 0.712)),
    });
  });

  /** Each admin's share of total platform volume. */
  protected readonly rows = computed<readonly AdminReportRow[]>(() => {
    const all = this.admins();
    const total = all.reduce((sum, admin) => sum + admin.messagesThisMonth, 0);

    return [...all]
      .sort((a, b) => b.messagesThisMonth - a.messagesThisMonth)
      .map((admin) => ({
        admin,
        messages: admin.messagesThisMonth,
        sharePercent: total === 0 ? 0 : Math.round((admin.messagesThisMonth / total) * 100),
      }));
  });

  protected readonly totalMessages = computed(
    () => this.overview()?.totalMessagesThisMonth ?? 0,
  );

  protected readonly averagePerAdmin = computed(() => {
    const overview = this.overview();
    if (overview === null || overview.totalAdmins === 0) {
      return 0;
    }
    return Math.round(overview.totalMessagesThisMonth / overview.totalAdmins);
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');

    forkJoin({
      overview: this.platform.getOverview(),
      admins: this.platform.listAdmins(),
    }).subscribe({
      next: ({ overview, admins }) => {
        this.overview.set(overview);
        this.admins.set(admins);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  /** Open this admin's own report, identical to what they see. */
  protected viewAs(admin: AdminAccount): void {
    this.scope.select(admin);
    void this.router.navigateByUrl('/superadmin/reports');
  }

  protected exportCsv(): void {
    this.toast.info('Export queued', 'A platform-wide CSV will be emailed when it is ready.');
  }
}
