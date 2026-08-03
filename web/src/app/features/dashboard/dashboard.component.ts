import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { AuthService } from '@core/auth/auth.service';
import type { DashboardSnapshot } from '@core/models/analytics.model';
import type { Campaign } from '@core/models/campaign.model';
import type { LoadState } from '@core/models/api.model';
import { DashboardService } from '@core/services/dashboard.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE } from '@shared/ui/badge/campaign-status';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { ChartComponent } from '@shared/ui/chart/chart.component';
import { areaTrendChart, deliveryDonutChart, funnelChart } from '@shared/ui/chart/chart.presets';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { StatCardComponent } from '@shared/ui/stat-card/stat-card.component';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DecimalPipe,
    TimeAgoPipe,
    PageHeaderComponent,
    StatCardComponent,
    CardComponent,
    ChartComponent,
    BadgeComponent,
    AvatarComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
  ],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly dashboardService = inject(DashboardService);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly snapshot = signal<DashboardSnapshot | null>(null);
  protected readonly campaigns = signal<readonly Campaign[]>([]);

  protected readonly statusTone = CAMPAIGN_STATUS_TONE;
  protected readonly statusLabel = CAMPAIGN_STATUS_LABEL;

  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const name = this.auth.user()?.name.split(' ')[0] ?? 'there';
    const partOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    return `Good ${partOfDay}, ${name}`;
  });

  protected readonly kpis = computed(() => this.snapshot()?.kpis ?? null);
  protected readonly activity = computed(() => this.snapshot()?.activity ?? []);

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

  protected readonly donutOptions = computed(() => {
    const kpis = this.kpis();
    if (kpis === null) {
      return deliveryDonutChart(0, 0, 0);
    }
    const pending = Math.max(0, kpis.messagesSent - kpis.delivered - kpis.failed);
    return deliveryDonutChart(kpis.delivered, kpis.failed, pending);
  });

  protected readonly recentCampaigns = computed(() =>
    this.campaigns()
      .filter((campaign) => campaign.status === 'completed' || campaign.status === 'sending')
      .slice(0, 5),
  );

  protected readonly upcomingCampaigns = computed(() =>
    this.campaigns()
      .filter((campaign) => campaign.status === 'scheduled')
      .slice(0, 3),
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');

    forkJoin({
      snapshot: this.dashboardService.getSnapshot(),
      campaigns: this.dashboardService.getCampaigns(),
    }).subscribe({
      next: ({ snapshot, campaigns }) => {
        this.snapshot.set(snapshot);
        this.campaigns.set(campaigns);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  /** Read rate against delivered, which is the meaningful denominator. */
  protected readRate(campaign: Campaign): number {
    const { delivered, read } = campaign.metrics;
    return delivered === 0 ? 0 : Math.round((read / delivered) * 100);
  }
}
