import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import type { LoadState } from '@core/models/api.model';
import type { QuotaUsage, ServiceHealth, SystemSnapshot } from '@core/models/platform.model';
import { PlatformService } from '@core/services/platform.service';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { ChartComponent } from '@shared/ui/chart/chart.component';
import { throughputChart } from '@shared/ui/chart/chart.presets';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const SERVICE_TONE: Readonly<Record<ServiceHealth['status'], BadgeTone>> = {
  operational: 'success',
  degraded: 'warning',
  outage: 'danger',
};

@Component({
  selector: 'app-monitoring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    PageHeaderComponent,
    CardComponent,
    ChartComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './monitoring.component.html',
})
export class MonitoringComponent {
  private readonly platform = inject(PlatformService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly snapshot = signal<SystemSnapshot | null>(null);
  protected readonly skeletons = [1, 2, 3, 4];

  protected readonly serviceTone = SERVICE_TONE;

  protected readonly services = computed(() => this.snapshot()?.services ?? []);
  protected readonly quotas = computed(() => this.snapshot()?.quotas ?? []);

  protected readonly allOperational = computed(() =>
    this.services().every((service) => service.status === 'operational'),
  );

  protected readonly throughputOptions = computed(() => {
    const throughput = this.snapshot()?.throughput ?? [];
    return throughputChart(
      throughput.map((sample) => sample.label),
      throughput.map((sample) => sample.value),
    );
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.platform.getSystemSnapshot().subscribe({
      next: (snapshot) => {
        this.snapshot.set(snapshot);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected quotaPercent(quota: QuotaUsage): number {
    return quota.limit === 0 ? 0 : Math.min(100, Math.round((quota.used / quota.limit) * 100));
  }

  protected quotaBarClass(quota: QuotaUsage): string {
    const percent = this.quotaPercent(quota);
    if (percent >= 90) {
      return 'bg-danger';
    }
    return percent >= 75 ? 'bg-warning' : 'bg-brand-500';
  }
}
