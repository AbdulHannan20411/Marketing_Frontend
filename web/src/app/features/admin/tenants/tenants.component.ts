import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { LoadState } from '@core/models/api.model';
import type { Tenant, TenantPlan, TenantStatus } from '@core/models/platform.model';
import { PlatformService } from '@core/services/platform.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { DataTableComponent, type TableColumn } from '@shared/ui/data-table/data-table.component';
import { TableRowDirective } from '@shared/ui/data-table/table-row.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { StatCardComponent } from '@shared/ui/stat-card/stat-card.component';

const STATUS_TONE: Readonly<Record<TenantStatus, BadgeTone>> = {
  active: 'success',
  trialing: 'info',
  suspended: 'danger',
};

const PLAN_TONE: Readonly<Record<TenantPlan, BadgeTone>> = {
  starter: 'neutral',
  growth: 'info',
  scale: 'brand',
  enterprise: 'warning',
};

const PAGE_SIZE = 10;

@Component({
  selector: 'app-tenants',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    PageHeaderComponent,
    DataTableComponent,
    TableRowDirective,
    StatCardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
  ],
  templateUrl: './tenants.component.html',
})
export class TenantsComponent {
  private readonly platform = inject(PlatformService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly tenants = signal<readonly Tenant[]>([]);
  protected readonly totalItems = signal(0);
  protected readonly page = signal(1);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly statusTone = STATUS_TONE;
  protected readonly planTone = PLAN_TONE;

  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', header: 'Workspace' },
    { key: 'plan', header: 'Plan', hideOnMobile: true },
    { key: 'status', header: 'Status' },
    { key: 'seats', header: 'Seats', align: 'right', hideOnMobile: true },
    { key: 'usage', header: 'Quota used', align: 'right' },
    { key: 'created', header: 'Created', align: 'right', hideOnMobile: true },
  ];

  protected readonly totals = computed(() => {
    const all = this.tenants();
    return {
      workspaces: this.totalItems(),
      active: all.filter((tenant) => tenant.status === 'active').length,
      seats: all.reduce((sum, tenant) => sum + tenant.seats, 0),
      messages: all.reduce((sum, tenant) => sum + tenant.messagesThisMonth, 0),
    };
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.platform.listTenants(this.page(), PAGE_SIZE).subscribe({
      next: (result) => {
        this.tenants.set(result.items);
        this.totalItems.set(result.totalItems);
        this.state.set(result.totalItems === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected quotaPercent(tenant: Tenant): number {
    return tenant.messageQuota === 0
      ? 0
      : Math.min(100, Math.round((tenant.messagesThisMonth / tenant.messageQuota) * 100));
  }

  /** Amber past 80% so an account close to its ceiling stands out in the list. */
  protected quotaBarClass(tenant: Tenant): string {
    const percent = this.quotaPercent(tenant);
    if (percent >= 90) {
      return 'bg-danger';
    }
    return percent >= 80 ? 'bg-warning' : 'bg-brand-500';
  }
}
