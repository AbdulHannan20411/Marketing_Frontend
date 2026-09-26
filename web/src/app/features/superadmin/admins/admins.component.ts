import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import type { ApiError, LoadState } from '@core/models/api.model';
import type { AdminAccount } from '@core/models/admin-account.model';
import type { TenantPlan, TenantStatus } from '@core/models/platform.model';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { latestRequest } from '@core/http/latest-request';
import { ADMIN_SORT_COLUMNS, PlatformService } from '@core/services/platform.service';
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
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { AdminEditorComponent, type AdminEditorResult } from './admin-editor.component';

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
    SortMenuComponent,
    PaginatorComponent,
    RouterLink,
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
    AdminEditorComponent,
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

  /** `null` = closed, `'new'` = create, otherwise the account being edited. */
  protected readonly editing = signal<AdminAccount | 'new' | null>(null);
  protected readonly confirmingDelete = signal<AdminAccount | null>(null);
  protected readonly saving = signal(false);
  protected readonly busyId = signal<string | null>(null);

  protected readonly editorAdmin = computed(() => {
    const target = this.editing();
    return target === null || target === 'new' ? null : target;
  });

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

  protected readonly totalItems = signal(0);
  /** False while `/superadmin/admins` still answers with the whole list. */
  protected readonly pagedByServer = signal(false);

  /** Keystrokes, before debouncing: one request per pause, not per letter. */
  private readonly searchInput = new Subject<string>();
  /** The page read, cancelled whenever a newer one starts. */
  private readonly listRequest = latestRequest();

  /** One page of admin cards. The platform list grows with every customer. */
  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
  });

  protected readonly sorter = serverSorter({
    columns: ADMIN_SORT_COLUMNS.map(({ key, label, initialDirection }) => ({
      key,
      label,
      initialDirection,
    })),
    load: () => {
      this.pager.reset();
      this.load();
    },
  });

  protected setStatusFilter(value: TenantStatus | 'all'): void {
    this.statusFilter.set(value);
    this.pager.reset();
    this.load();
  }

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
    this.searchInput
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        this.pager.reset();
        this.load();
      });

    this.load();
  }

  /**
   * One page, from the API.
   *
   * The page, the search, the status filter and the order all go to the
   * server. Where `/superadmin/admins` still answers with the whole list the
   * service applies them instead, so this screen reads the same either way.
   */
  protected load(): void {
    this.state.set('loading');

    this.platform
      .pageAdmins({
        page: this.pager.page(),
        pageSize: this.pager.pageSize(),
        search: this.search(),
        status: this.statusFilter(),
        sortBy: this.sorter.key(),
        sortDirection: this.sorter.direction(),
      })
      .pipe(this.listRequest.only())
      .subscribe({
        next: (page) => {
          this.admins.set(page.items);
          this.totalItems.set(page.totalItems);
          this.pagedByServer.set(page.pagedByServer);
          this.state.set(page.totalItems === 0 ? 'empty' : 'ready');
        },
        error: () => this.state.set('error'),
      });
  }

  /** Debounced, then reloaded: the search is the server's now. */
  protected onSearch(event: Event): void {
    this.searchInput.next((event.target as HTMLInputElement).value);
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

  /* ------------------------------ account writes ------------------------------ */

  protected openCreate(): void {
    this.editing.set('new');
  }

  protected openEdit(event: Event, admin: AdminAccount): void {
    event.stopPropagation();
    this.editing.set(admin);
  }

  protected closeEditor(): void {
    this.editing.set(null);
  }

  protected onSave(result: AdminEditorResult): void {
    const target = this.editing();
    if (target === null) {
      return;
    }
    this.saving.set(true);

    const request$ =
      target === 'new'
        ? this.platform.createAdmin({
            name: result.name,
            email: result.email,
            organisation: result.organisation,
          })
        : this.platform.updateAdmin(target.id, {
            name: result.name,
            organisation: result.organisation,
            plan: result.plan ?? target.plan,
          });

    request$.subscribe({
      next: (admin) => {
        this.saving.set(false);
        this.editing.set(null);
        this.toast.success(
          target === 'new' ? 'Admin account created' : 'Account updated',
          target === 'new'
            ? `Invitation emailed to ${admin.email}. ${admin.organisation} activates once they set a password.`
            : admin.organisation,
        );
        this.load();
      },
      // email_taken and organisation_exists arrive as 409 with a usable detail.
      error: (error: ApiError) => {
        this.saving.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  /** Approves a pending account, or suspends/reinstates an existing one. */
  protected setStatus(event: Event, admin: AdminAccount, status: TenantStatus): void {
    event.stopPropagation();
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(admin.id);

    this.platform.updateAdminStatus(admin.id, status).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.toast.success(
          status === 'active' ? 'Account activated' : 'Account updated',
          status === 'active'
            ? `${updated.organisation} can now sign in and use the platform.`
            : `${updated.organisation} is now ${status}.`,
        );
        this.load();
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected askDelete(event: Event, admin: AdminAccount): void {
    event.stopPropagation();
    this.confirmingDelete.set(admin);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected confirmDelete(): void {
    const admin = this.confirmingDelete();
    if (admin === null) {
      return;
    }

    this.platform.removeAdmin(admin.id).subscribe({
      next: () => {
        this.confirmingDelete.set(null);
        // Leaving a deleted account selected would scope every page to nothing.
        if (this.scope.selectedId() === admin.id) {
          this.scope.clear();
        }
        this.toast.success('Account removed', `${admin.organisation} was deleted.`);
        this.load();
      },
      error: (error: ApiError) => {
        this.confirmingDelete.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
