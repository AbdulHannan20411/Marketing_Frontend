import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import type { PaymentRequest } from '@core/models/payment-request.model';
import { FEATURE_MODULE_LABEL, type FeatureModule } from '@core/models/permission.model';
import type { SubscriptionStatus } from '@core/models/subscription.model';
import { EntitlementService, type UsageView } from '@core/services/entitlement.service';
import { PaymentRequestService } from '@core/services/payment-request.service';
import { RealtimeService } from '@core/services/realtime.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { ProgressRingComponent, type RingTone } from '@shared/ui/progress-ring/progress-ring.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { UsageBarComponent } from '@shared/ui/usage-bar/usage-bar.component';

const STATUS_TONE: Readonly<Record<SubscriptionStatus, BadgeTone>> = {
  active: 'success',
  trial: 'info',
  expired: 'danger',
  suspended: 'danger',
  cancelled: 'neutral',
};

const STATUS_LABEL: Readonly<Record<SubscriptionStatus, string>> = {
  active: 'Active',
  trial: 'Trial',
  expired: 'Expired',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

/** Metrics promoted to circular indicators; the rest render as bars. */
const HEADLINE_METRICS = ['contacts', 'campaigns', 'employees', 'storage'] as const;

@Component({
  selector: 'app-subscription',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    ProgressRingComponent,
    UsageBarComponent,
    SkeletonComponent,
  ],
  templateUrl: './subscription.component.html',
})
export class SubscriptionComponent {
  private readonly entitlements = inject(EntitlementService);
  private readonly payments = inject(PaymentRequestService);
  private readonly realtime = inject(RealtimeService);

  /**
   * The most recent manual payment, if any.
   *
   * Worth surfacing here because the plan above is unchanged until it is
   * approved — without this, a customer who has paid sees no acknowledgement
   * anywhere and pays again.
   */
  protected readonly latestPayment = signal<PaymentRequest | null>(null);
  protected readonly withdrawing = signal(false);

  protected readonly paymentPending = computed(
    () => this.latestPayment()?.status === 'pending',
  );

  protected readonly paymentRejected = computed(
    () => this.latestPayment()?.status === 'rejected',
  );

  protected readonly isLocked = this.entitlements.isLocked;
  protected readonly lockReason = this.entitlements.lockReason;

  protected readonly isLoaded = this.entitlements.isLoaded;
  protected readonly subscription = this.entitlements.subscription;
  protected readonly plan = this.entitlements.plan;
  protected readonly usage = this.entitlements.usage;
  protected readonly daysRemaining = this.entitlements.daysRemaining;
  protected readonly isExpiringSoon = this.entitlements.isExpiringSoon;

  protected readonly statusTone = STATUS_TONE;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly moduleLabel = FEATURE_MODULE_LABEL;
  protected readonly skeletons = [1, 2, 3, 4];

  protected readonly headline = computed<readonly UsageView[]>(() =>
    HEADLINE_METRICS.map((key) => this.entitlements.usageFor(key)).filter(
      (metric): metric is UsageView => metric !== null,
    ),
  );

  protected readonly platformUsage = computed(() =>
    this.usage().filter(
      (metric) => metric.key === 'apiCalls' || metric.key.startsWith('messages'),
    ),
  );

  protected readonly channelUsage = computed(() =>
    this.usage().filter((metric) => metric.key.endsWith('Accounts')),
  );

  /** Cycle progress, so the renewal card reads as a timeline not just a date. */
  protected readonly cycleProgress = computed(() => {
    const subscription = this.subscription();
    if (subscription === null) {
      return 0;
    }
    const start = Date.parse(subscription.currentPeriodStart);
    const end = Date.parse(subscription.currentPeriodEnd);
    if (end <= start) {
      return 0;
    }
    const elapsed = Date.now() - start;
    return Math.min(100, Math.max(0, Math.round((elapsed / (end - start)) * 100)));
  });

  protected readonly enabledModules = computed<readonly FeatureModule[]>(() => {
    const plan = this.plan();
    if (plan === null) {
      return [];
    }
    return (Object.keys(plan.modules) as FeatureModule[]).filter((key) => plan.modules[key]);
  });

  protected readonly disabledModules = computed<readonly FeatureModule[]>(() => {
    const plan = this.plan();
    if (plan === null) {
      return [];
    }
    return (Object.keys(plan.modules) as FeatureModule[]).filter((key) => !plan.modules[key]);
  });

  constructor() {
    this.loadLatestPayment();

    // A decision arrives while the customer is looking at this page.
    this.realtime.paymentRequests$
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.loadLatestPayment();
        this.entitlements.load();
      });
  }

  /** Withdraws the open request, freeing the workspace to submit another. */
  protected withdrawPayment(): void {
    const request = this.latestPayment();
    if (request === null || this.withdrawing()) {
      return;
    }
    this.withdrawing.set(true);

    this.payments.cancel(request.id).subscribe({
      next: (updated) => {
        this.withdrawing.set(false);
        this.latestPayment.set(updated);
      },
      error: () => {
        this.withdrawing.set(false);
        // Most likely it was decided a moment ago; showing the truth beats an error.
        this.loadLatestPayment();
      },
    });
  }

  private loadLatestPayment(): void {
    this.payments.latestMine().subscribe({
      next: (request) => this.latestPayment.set(request),
      // A missing payment history is not an error worth showing here.
      error: () => this.latestPayment.set(null),
    });
  }

  protected ringTone(metric: UsageView): RingTone {
    switch (metric.severity) {
      case 'exceeded':
      case 'critical':
        return 'danger';
      case 'warning':
        return 'warning';
      default:
        return 'brand';
    }
  }
}
