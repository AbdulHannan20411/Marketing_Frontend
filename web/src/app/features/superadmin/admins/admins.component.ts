import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import type { LoadState } from '@core/models/api.model';
import type { AdminAccount } from '@core/models/admin-account.model';
import type { TenantPlan, TenantStatus } from '@core/models/platform.model';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { PlatformService } from '@core/services/platform.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

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

/**
 * The Super Admin's entry point into every module.
 *
 * Choosing an Admin sets the portal-wide scope and continues to whichever page
 * the user was heading for (carried in `?next=`), so the picker doubles as the
 * gate in front of scoped routes.
 */
@Component({
  selector: 'app-superadmin-admins',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    AvatarComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './admins.component.html',
})
export class SuperAdminAdminsComponent {
  private readonly platform = inject(PlatformService);
  private readonly scope = inject(AdminScopeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly state = signal<LoadState>('loading');
  protected readonly admins = signal<readonly AdminAccount[]>([]);
  protected readonly search = signal('');
  protected readonly statusFilter = signal<TenantStatus | 'all'>('all');
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];

  protected readonly statusTone = STATUS_TONE;
  protected readonly planTone = PLAN_TONE;
  protected readonly selectedId = this.scope.selectedId;

  /** Where to continue after a selection; the dashboard by default. */
  protected readonly nextUrl = computed(
    () => this.queryParams()?.get('next') ?? '/superadmin/dashboard',
  );

  protected readonly isGateMode = computed(() => this.queryParams()?.get('next') !== null);

  protected readonly statuses: readonly { value: TenantStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'trialing', label: 'Trialing' },
    { value: 'suspended', label: 'Suspended' },
  ];

  protected readonly visibleAdmins = computed(() => {
    const term = this.search().trim().toLowerCase();
    const status = this.statusFilter();

    return this.admins().filter((admin) => {
      const matchesStatus = status === 'all' || admin.status === status;
      const matchesSearch =
        term === '' ||
        admin.name.toLowerCase().includes(term) ||
        admin.organisation.toLowerCase().includes(term) ||
        admin.email.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  });

  protected readonly totals = computed(() => {
    const all = this.admins();
    return {
      admins: all.length,
      employees: all.reduce((sum, admin) => sum + admin.employeeCount, 0),
      contacts: all.reduce((sum, admin) => sum + admin.contactCount, 0),
      campaigns: all.reduce((sum, admin) => sum + admin.campaignCount, 0),
    };
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.platform.listAdmins().subscribe({
      next: (admins) => {
        this.admins.set(admins);
        this.state.set(admins.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** Enter this Admin's context and continue to the requested page. */
  protected select(admin: AdminAccount): void {
    this.scope.select(admin);
    void this.router.navigateByUrl(this.nextUrl());
  }

  protected viewDashboard(event: Event, admin: AdminAccount): void {
    event.stopPropagation();
    this.scope.select(admin);
    void this.router.navigateByUrl('/superadmin/dashboard');
  }

  protected clearScope(): void {
    this.scope.clear();
  }

  protected pendingWrite(action: string, admin: AdminAccount): void {
    this.toast.info(`${action} ${admin.organisation}`, 'Admin write endpoints land with the account-management milestone.');
  }
}
