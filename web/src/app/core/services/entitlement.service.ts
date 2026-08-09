import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import type { FeatureModule } from '@core/models/permission.model';
import type {
  SubscriptionPlan,
  SubscriptionSnapshot,
  UsageMetric,
  UsageMetricKey,
} from '@core/models/subscription.model';
import { SubscriptionService } from './subscription.service';

export type UsageSeverity = 'ok' | 'warning' | 'critical' | 'exceeded';

export interface UsageView extends UsageMetric {
  /** 0–100. Unlimited allowances report 0 so bars stay empty rather than full. */
  readonly percent: number;
  readonly remaining: number | null;
  readonly unlimited: boolean;
  readonly severity: UsageSeverity;
}

const WARNING_THRESHOLD = 75;
const CRITICAL_THRESHOLD = 90;

function toView(metric: UsageMetric): UsageView {
  const unlimited = metric.limit === null;

  if (unlimited) {
    return { ...metric, percent: 0, remaining: null, unlimited: true, severity: 'ok' };
  }

  const limit = metric.limit ?? 0;
  const percent = limit === 0 ? 100 : Math.min(100, Math.round((metric.used / limit) * 100));
  const remaining = Math.max(0, limit - metric.used);

  const severity: UsageSeverity =
    metric.used >= limit
      ? 'exceeded'
      : percent >= CRITICAL_THRESHOLD
        ? 'critical'
        : percent >= WARNING_THRESHOLD
          ? 'warning'
          : 'ok';

  return { ...metric, percent, remaining, unlimited: false, severity };
}

/**
 * Single source of truth for what the current subscription allows.
 *
 * Everything that gates UI — the sidebar, route guards, the `appHasFeature`
 * directive and limit prompts — reads from here, so a plan change propagates
 * everywhere without any page needing to refetch.
 */
@Injectable({ providedIn: 'root' })
export class EntitlementService {
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly auth = inject(AuthService);
  private readonly scope = inject(AdminScopeService);

  private readonly snapshot = signal<SubscriptionSnapshot | null>(null);
  private readonly loaded = signal(false);

  /**
   * Plan limits are a property of an Admin's subscription, so they never apply
   * to a SuperAdmin. When true, every gate opens and usage reports as
   * unlimited — no caps, no upgrade prompts.
   */
  readonly isUnrestricted = computed(() => this.auth.isSuperAdmin());

  readonly isLoaded = this.loaded.asReadonly();
  readonly subscription = computed(() => this.snapshot()?.subscription ?? null);
  readonly plan = computed<SubscriptionPlan | null>(() => this.snapshot()?.plan ?? null);

  readonly usage = computed<readonly UsageView[]>(() => {
    const metrics = this.snapshot()?.usage ?? [];
    return this.isUnrestricted()
      ? metrics.map((metric) => toView({ ...metric, limit: null }))
      : metrics.map(toView);
  });

  private readonly usageByKey = computed(() => {
    const lookup = new Map<UsageMetricKey, UsageView>();
    for (const view of this.usage()) {
      lookup.set(view.key, view);
    }
    return lookup;
  });

  /** Whole days left before the subscription lapses; never negative. */
  readonly daysRemaining = computed(() => {
    const subscription = this.subscription();
    if (subscription === null) {
      return 0;
    }
    const millis = new Date(subscription.expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(millis / 86_400_000));
  });

  readonly isExpiringSoon = computed(
    () => this.subscription() !== null && this.daysRemaining() <= 14,
  );

  readonly isTrial = computed(() => this.subscription()?.status === 'trial');

  readonly isActive = computed(() => {
    const status = this.subscription()?.status;
    return status === 'active' || status === 'trial';
  });

  /** Metrics at or past their ceiling, used to drive upgrade prompts. */
  readonly breachedMetrics = computed(() =>
    this.isUnrestricted()
      ? []
      : this.usage().filter((metric) => metric.severity === 'exceeded'),
  );

  load(): void {
    // A Super Admin has no tenant of their own, so /subscription would 404 on
    // every page load. Only fetch when there is a tenant to fetch for: their
    // own (Admin, Employee) or the one they are scoped to.
    if (this.auth.isSuperAdmin() && this.scope.selectedId() === null) {
      this.snapshot.set(null);
      this.loaded.set(true);
      return;
    }

    this.subscriptionService.getSnapshot().subscribe({
      next: (snapshot) => {
        this.snapshot.set(snapshot);
        this.loaded.set(true);
      },
      // A failed entitlement fetch must not lock the user out of the whole app;
      // gates fall back to "unknown" and pages render their own error states.
      error: () => this.loaded.set(true),
    });
  }

  /**
   * Whether the plan includes a module. Returns `true` while entitlements are
   * still loading so the shell does not flash-hide navigation on first paint.
   */
  hasFeature(module: FeatureModule): boolean {
    if (this.isUnrestricted()) {
      return true;
    }
    const plan = this.plan();
    return plan === null ? !this.loaded() : plan.modules[module];
  }

  usageFor(key: UsageMetricKey): UsageView | null {
    return this.usageByKey().get(key) ?? null;
  }

  /** True when a metric has hit its ceiling and the action should be blocked. */
  hasReachedLimit(key: UsageMetricKey): boolean {
    return !this.isUnrestricted() && this.usageFor(key)?.severity === 'exceeded';
  }
}
