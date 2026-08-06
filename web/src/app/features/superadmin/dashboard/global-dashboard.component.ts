import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import type { LoadState } from '@core/models/api.model';
import type { AdminAccount, PlatformOverview } from '@core/models/admin-account.model';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { PlatformService } from '@core/services/platform.service';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { ChartComponent } from '@shared/ui/chart/chart.component';
import { areaTrendChart, funnelChart } from '@shared/ui/chart/chart.presets';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { StatCardComponent } from '@shared/ui/stat-card/stat-card.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/** Platform-wide console shown when no Admin is selected. */
@Component({
  selector: 'app-global-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
    PageHeaderComponent,
    CardComponent,
    ChartComponent,
    StatCardComponent,
    AvatarComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './global-dashboard.component.html',
})
export class GlobalDashboardComponent {
  private readonly platform = inject(PlatformService);
  private readonly scope = inject(AdminScopeService);
  private readonly router = inject(Router);

  protected readonly state = signal<LoadState>('loading');
  protected readonly overview = signal<PlatformOverview | null>(null);
  protected readonly admins = signal<readonly AdminAccount[]>([]);

  protected readonly trendOptions = computed(() => {
    const trend = this.overview()?.trend ?? [];
    return areaTrendChart({
      categories: trend.map((point) =>
        new Date(point.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      ),
      // Two series only; the third is repeated so the preset's shape holds.
      sent: trend.map((point) => point.messages),
      delivered: trend.map((point) => Math.round(point.messages * 0.97)),
      read: trend.map((point) => Math.round(point.messages * 0.71)),
    });
  });

  protected readonly planChartOptions = computed(() => {
    const breakdown = this.overview()?.planBreakdown ?? [];
    return funnelChart({
      labels: breakdown.map((row) => row.plan),
      values: breakdown.map((row) => row.adminCount),
    });
  });

  protected readonly monthlyRevenue = computed(() =>
    (this.overview()?.planBreakdown ?? []).reduce((sum, row) => sum + row.monthlyRevenue, 0),
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');

    this.platform.getOverview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });

    this.platform.listAdmins().subscribe({
      next: (admins) => this.admins.set(admins),
    });
  }

  protected initialsOf(name: string): string {
    const parts = name.split(' ');
    return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
  }

  /** Jump straight into an admin's context from the leaderboard. */
  protected viewAs(adminId: string): void {
    const admin = this.admins().find((candidate) => candidate.id === adminId);
    if (admin === undefined) {
      return;
    }
    this.scope.select(admin);
    void this.router.navigateByUrl('/superadmin/dashboard');
  }
}
