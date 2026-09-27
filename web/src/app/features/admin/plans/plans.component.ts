import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { latestRequest } from '@core/http/latest-request';

import type { ApiError, LoadState } from '@core/models/api.model';
import { FEATURE_MODULE_LABEL, type FeatureModule } from '@core/models/permission.model';
import type { PlanStatus, SubscriptionPlan } from '@core/models/subscription.model';
import {
  PlanAdminService,
  PLAN_SORT_COLUMNS,
  type PlanDraft,
} from '@core/services/plan-admin.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { serverSorter } from '@shared/ui/data-table/sort';
import { serverPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import {
  SearchBoxComponent,
  SEARCH_DEBOUNCE_MS,
} from '@shared/ui/search-box/search-box.component';
import { SortMenuComponent } from '@shared/ui/data-table/sort-menu.component';
import { HistoryButtonComponent } from '@shared/audit/history-button.component';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { MenuItemDirective } from '@shared/ui/menu/menu-item.directive';
import { RowActionsComponent } from '@shared/ui/menu/row-actions.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { PlanEditorComponent } from './plan-editor.component';

const STATUS_TONE: Readonly<Record<PlanStatus, BadgeTone>> = {
  active: 'success',
  inactive: 'warning',
  archived: 'neutral',
};

type StatusFilter = PlanStatus | 'all';

@Component({
  selector: 'app-plans',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SearchBoxComponent,
    PaginatorComponent,
    SortMenuComponent,
    HistoryButtonComponent,
    RowActionsComponent,
    MenuItemDirective,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    PlanEditorComponent,
  ],
  templateUrl: './plans.component.html',
})
export class PlansComponent {
  private readonly planAdmin = inject(PlanAdminService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly plans = signal<readonly SubscriptionPlan[]>([]);
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly skeletons = [1, 2, 3, 4];

  /** `null` = closed, `'new'` = create, otherwise the plan being edited. */
  protected readonly editing = signal<SubscriptionPlan | 'new' | null>(null);
  protected readonly confirmingDelete = signal<SubscriptionPlan | null>(null);
  protected readonly saving = signal(false);

  protected readonly statusTone = STATUS_TONE;
  protected readonly moduleLabel = FEATURE_MODULE_LABEL;

  protected readonly statuses: readonly { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All plans' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'archived', label: 'Archived' },
  ];

  protected readonly editorPlan = computed(() => {
    const target = this.editing();
    return target === null || target === 'new' ? null : target;
  });

  protected readonly search = signal('');
  /** Whether a term is narrowing the list. Decides which empty state is right. */
  protected readonly searching = computed(() => this.search().trim() !== '');
  /** True until the first answer arrives, so the toolbar is not built early. */
  protected readonly firstLoad = signal(true);
  protected readonly totalItems = signal(0);

  /** Keystrokes, before debouncing: one request per pause, not per letter. */
  private readonly searchInput = new Subject<string>();
  private readonly listRequest = latestRequest();

  /** What the cards render: one page, as the API returned it. */
  protected readonly visiblePlans = this.plans;

  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
  });

  protected readonly sorter = serverSorter({
    columns: PLAN_SORT_COLUMNS.map(({ key, label, initialDirection }) => ({
      key,
      label,
      initialDirection,
    })),
    load: () => {
      this.pager.reset();
      this.load();
    },
  });

  /**
   * The header figures, which describe every plan rather than this page.
   *
   * Taken from the whole collection while `/admin/plans` still answers with
   * it. When it starts paging, `all` is null and these fall back to the page
   * total alone — the point at which the API needs to send the counts, which
   * is asked for in `docs/API-LIST-PAGINATION-BACKEND.md`.
   */
  private readonly everyPlan = signal<readonly SubscriptionPlan[] | null>(null);

  protected readonly counts = computed(() => {
    const all = this.everyPlan();
    if (all === null) {
      return { total: this.totalItems(), active: null, promotional: null };
    }
    return {
      total: all.length,
      active: all.filter((plan) => plan.status === 'active').length,
      promotional: all.filter((plan) => plan.isPromotional).length,
    };
  });

  constructor() {
    this.searchInput
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed())
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
   * The page, the search, the status tab and the order all go to the server.
   * `/admin/plans` honours none of them yet, so the service applies them to
   * the collection it answers with — the screen reads the same either way.
   */
  protected load(): void {
    this.state.set('loading');

    this.planAdmin
      .page({
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
          this.plans.set(page.items);
          this.everyPlan.set(page.all);
          this.totalItems.set(page.totalItems);
          this.state.set(page.totalItems === 0 ? 'empty' : 'ready');
          this.firstLoad.set(false);
        },
        error: () => {
          this.state.set('error');
          this.firstLoad.set(false);
        },
      });
  }

  /** The status tab is a filter the API applies, so it re-reads page one. */
  protected setStatusFilter(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.pager.reset();
    this.load();
  }

  protected onSearch(term: string): void {
    this.searchInput.next(term);
  }

  protected enabledModules(plan: SubscriptionPlan): readonly FeatureModule[] {
    return (Object.keys(plan.modules) as FeatureModule[]).filter((key) => plan.modules[key]);
  }

  protected openCreate(): void {
    this.editing.set('new');
  }

  protected openEdit(plan: SubscriptionPlan): void {
    this.editing.set(plan);
  }

  protected closeEditor(): void {
    this.editing.set(null);
  }

  protected onSave(draft: PlanDraft): void {
    const target = this.editing();
    if (target === null) {
      return;
    }
    this.saving.set(true);

    const request$ =
      target === 'new' ? this.planAdmin.create(draft) : this.planAdmin.update(target.id, draft);

    request$.subscribe({
      next: (plan) => {
        this.saving.set(false);
        this.editing.set(null);
        this.toast.success(
          target === 'new' ? 'Plan created' : 'Plan saved',
          `${plan.name} is now ${plan.status}.`,
        );
        // An API that predates the field accepts the save and silently drops
        // it. Say so, rather than let the editor look like it forgot.
        const sent = draft.limits?.maxSearchRadiusKm;
        const kept = plan.limits.maxSearchRadiusKm;
        if (sent !== undefined && kept !== sent) {
          this.toast.warning(
            'Search radius was not saved',
            kept === undefined
              ? 'The server does not store this limit yet. Restart the API with its latest update, then save again.'
              : `The server kept ${kept === null ? 'unlimited' : `${kept} km`} instead.`,
          );
        }
        this.load();
      },
      error: (error: ApiError) => {
        this.saving.set(false);
        const first = Object.values(error.fieldErrors ?? {})[0]?.[0];
        this.toast.error(
          'Could not save plan',
          error.status === 422 ? (first ?? error.detail) : 'The request failed. Please try again.',
        );
      },
    });
  }

  protected duplicate(plan: SubscriptionPlan): void {
    this.planAdmin.duplicate(plan.id).subscribe({
      next: (copy) => {
        this.toast.success('Plan duplicated', `${copy.name} was created as inactive.`);
        this.load();
      },
      error: () => this.toast.error('Could not duplicate', 'The request failed.'),
    });
  }

  /** Archive and activate/deactivate are both just a status change. */
  protected setStatus(plan: SubscriptionPlan, status: PlanStatus): void {
    this.planAdmin.update(plan.id, { status }).subscribe({
      next: (updated) => {
        this.toast.success('Plan updated', `${updated.name} is now ${status}.`);
        this.load();
      },
      error: () => this.toast.error('Could not update plan', 'The request failed.'),
    });
  }

  protected askDelete(plan: SubscriptionPlan): void {
    this.confirmingDelete.set(plan);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected confirmDelete(): void {
    const plan = this.confirmingDelete();
    if (plan === null) {
      return;
    }

    this.planAdmin.remove(plan.id).subscribe({
      next: () => {
        this.confirmingDelete.set(null);
        this.toast.success('Plan deleted', `${plan.name} was removed.`);
        this.load();
      },
      error: () => {
        this.confirmingDelete.set(null);
        this.toast.error('Could not delete plan', 'The request failed.');
      },
    });
  }
}
