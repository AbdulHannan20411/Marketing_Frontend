import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { ApiError, LoadState } from '@core/models/api.model';
import { FEATURE_MODULE_LABEL, type FeatureModule } from '@core/models/permission.model';
import type { BillingCycle, SubscriptionPlan, SupportLevel } from '@core/models/subscription.model';
import { EntitlementService } from '@core/services/entitlement.service';
import { SubscriptionService } from '@core/services/subscription.service';
import { ToastService } from '@core/services/toast.service';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const SUPPORT_LABEL: Readonly<Record<SupportLevel, string>> = {
  community: 'Community support',
  email: 'Email support',
  priority: 'Priority support',
  dedicated: 'Dedicated manager',
};

export interface LimitRow {
  readonly label: string;
  readonly value: string;
}

@Component({
  selector: 'app-pricing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './pricing.component.html',
})
export class PricingComponent {
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly entitlements = inject(EntitlementService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly plans = signal<readonly SubscriptionPlan[]>([]);
  protected readonly cycle = signal<BillingCycle>('monthly');
  protected readonly changing = signal<string | null>(null);
  protected readonly skeletons = [1, 2, 3, 4];

  protected readonly moduleLabel = FEATURE_MODULE_LABEL;
  protected readonly supportLabel = SUPPORT_LABEL;
  protected readonly currentPlanId = computed(() => this.entitlements.plan()?.id ?? null);

  protected readonly visiblePlans = computed(() =>
    [...this.plans()].sort((a, b) => a.sortOrder - b.sortOrder),
  );

  /** Yearly saving on the most popular plan, used for the toggle hint. */
  protected readonly yearlySavingPercent = computed(() => {
    const reference =
      this.visiblePlans().find((plan) => plan.isMostPopular) ?? this.visiblePlans()[0];
    if (reference === undefined || reference.monthlyPrice === 0) {
      return 0;
    }
    const yearlyAsMonthly = reference.yearlyPrice / 12;
    return Math.round((1 - yearlyAsMonthly / reference.monthlyPrice) * 100);
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.subscriptionService.listPlans().subscribe({
      next: (plans) => {
        this.plans.set(plans);
        this.state.set(plans.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected priceFor(plan: SubscriptionPlan): number {
    return this.cycle() === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
  }

  /** Yearly plans are shown as an equivalent monthly figure for comparability. */
  protected monthlyEquivalent(plan: SubscriptionPlan): number {
    return this.cycle() === 'yearly' ? Math.round(plan.yearlyPrice / 12) : plan.monthlyPrice;
  }

  protected enabledModules(plan: SubscriptionPlan): readonly FeatureModule[] {
    return (Object.keys(plan.modules) as FeatureModule[]).filter((key) => plan.modules[key]);
  }

  protected limitRows(plan: SubscriptionPlan): readonly LimitRow[] {
    const format = (value: number | null, suffix = ''): string =>
      value === null ? 'Unlimited' : `${value.toLocaleString()}${suffix}`;

    return [
      { label: 'Contacts', value: format(plan.limits.maxContacts) },
      { label: 'Employees', value: format(plan.limits.maxEmployees) },
      { label: 'Campaigns', value: format(plan.limits.maxCampaigns) },
      { label: 'WhatsApp accounts', value: format(plan.limits.maxWhatsAppAccounts) },
      { label: 'Email accounts', value: format(plan.limits.maxEmailAccounts) },
      { label: 'Social accounts', value: format(plan.limits.maxSocialAccounts) },
      {
        label: 'Storage',
        value:
          plan.limits.maxStorageMb === null
            ? 'Unlimited'
            : `${Math.round(plan.limits.maxStorageMb / 1024).toLocaleString()} GB`,
      },
      { label: 'API requests', value: format(plan.limits.maxApiCallsPerMonth, ' / mo') },
      { label: 'Daily messages', value: format(plan.limits.dailyMessageLimit) },
      { label: 'Monthly messages', value: format(plan.limits.monthlyMessageLimit) },
    ];
  }

  protected isCurrent(plan: SubscriptionPlan): boolean {
    return plan.id === this.currentPlanId();
  }

  protected choose(plan: SubscriptionPlan): void {
    if (this.isCurrent(plan) || this.changing() !== null) {
      return;
    }
    this.changing.set(plan.id);

    this.subscriptionService.changePlan({ planId: plan.id, billingCycle: this.cycle() }).subscribe({
      next: (snapshot) => {
        this.changing.set(null);
        // Re-read entitlements so gating, gauges and the sidebar follow at once.
        this.entitlements.load();
        this.toast.success(
          `Now on ${snapshot.plan.name}`,
          'Your plan has been updated for this workspace.',
        );
      },
      // A downgrade below current usage returns 409 naming the blocking metric.
      error: (error: ApiError) => {
        this.changing.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
