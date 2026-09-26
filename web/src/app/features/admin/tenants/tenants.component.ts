import { RouterLink } from '@angular/router';
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
import { serverSorter } from '@shared/ui/data-table/sort';
import { serverPager } from '@shared/ui/pagination/pager';
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
    RouterLink,
  ],
  templateUrl: './tenants.component.html',
})
export class TenantsComponent {
  private readonly platform = inject(PlatformService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly tenants = signal<readonly Tenant[]>([]);
  protected readonly totalItems = signal(0);

  /** The API pages tenants; `load()` reads the page and size from here. */
  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
  });
  protected readonly statusTone = STATUS_TONE;
  protected readonly planTone = PLAN_TONE;

  protected readonly columns: readonly TableColumn[] = [
    { key: 'id', header: 'ID', widthClass: 'w-28', sortKey: 'id' },
    { key: 'name', header: 'Workspace', sortKey: 'name' },
    { key: 'plan', header: 'Plan', hideOnMobile: true, sortKey: 'plan' },
    { key: 'status', header: 'Status', sortKey: 'status' },
    { key: 'seats', header: 'Seats', align: 'right', hideOnMobile: true, sortKey: 'seats' },
    // Quota used is a ratio the API does not sort on; messages sent is the
    // figure behind it and is in the allow-list.
    {
      key: 'usage',
      header: 'Quota used',
      align: 'right',
      sortKey: 'messagesThisMonth',
    },
    {
      key: 'created',
      header: 'Created',
      align: 'right',
      hideOnMobile: true,
      sortKey: 'createdAt',
    },
    { key: 'security', header: 'Security', align: 'right' },
  ];

  /** Ordered by the API — this list is paged there. */
  protected readonly sorter = serverSorter({
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Workspace' },
      { key: 'plan', label: 'Plan' },
      { key: 'status', label: 'Status' },
      { key: 'seats', label: 'Seats', initialDirection: 'desc' },
      { key: 'messagesThisMonth', label: 'Messages', initialDirection: 'desc' },
      { key: 'createdAt', label: 'Created', initialDirection: 'desc' },
    ],
    load: () => {
      this.pager.reset();
      this.load();
    },
  });

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
    this.platform
      .listTenants(
        this.pager.page(),
        this.pager.pageSize(),
        this.sorter.key(),
        this.sorter.direction(),
      )
      .subscribe({
      next: (result) => {
        this.tenants.set(result.items);
        this.totalItems.set(result.totalItems);
        this.state.set(result.totalItems === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
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
