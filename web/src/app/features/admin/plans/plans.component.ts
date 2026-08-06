import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { LoadState } from '@core/models/api.model';
import { FEATURE_MODULE_LABEL, type FeatureModule } from '@core/models/permission.model';
import type { PlanStatus, SubscriptionPlan } from '@core/models/subscription.model';
import { PlanAdminService, type PlanDraft } from '@core/services/plan-admin.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
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

  protected readonly visiblePlans = computed(() => {
    const filter = this.statusFilter();
    const sorted = [...this.plans()].sort((a, b) => a.sortOrder - b.sortOrder);
    return filter === 'all' ? sorted : sorted.filter((plan) => plan.status === filter);
  });

  protected readonly counts = computed(() => {
    const all = this.plans();
    return {
      total: all.length,
      active: all.filter((plan) => plan.status === 'active').length,
      promotional: all.filter((plan) => plan.isPromotional).length,
    };
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.planAdmin.list().subscribe({
      next: (plans) => {
        this.plans.set(plans);
        this.state.set(plans.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
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
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Could not save plan', 'The request failed. Please try again.');
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
