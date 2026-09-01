import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import type { FeatureModule } from '@core/models/permission.model';
import type {
  EntitlementSnapshot,
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

  private readonly snapshot = signal<EntitlementSnapshot | null>(null);
  private readonly loaded = signal(false);
  /** True when the fetch failed, as opposed to succeeding with nothing. */
  private readonly failed = signal(false);

  /**
   * Plan limits are a property of an Admin's subscription, so they never apply
   * to a SuperAdmin. When true, every gate opens and usage reports as
   * unlimited — no caps, no upgrade prompts.
   */
  readonly isUnrestricted = computed(() => this.auth.isSuperAdmin());

  readonly isLoaded = this.loaded.asReadonly();

  /**
   * The entitlement payload is flat — `status` and `expiresAt` sit beside
   * `modules` and `limits` rather than under a `subscription` and a `plan`.
   * These keep the old call sites reading naturally without reintroducing the
   * nesting.
   */
  readonly subscription = computed(() => this.snapshot());
  readonly planId = computed(() => this.snapshot()?.planId ?? null);
  readonly planName = computed(() => this.snapshot()?.planName ?? null);
  readonly limits = computed(() => this.snapshot()?.limits ?? null);

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

  /**
   * A workspace that may sign in but may not use the product.
   *
   * Locking rather than blocking the login is deliberate: the person who can
   * fix it is the one signing in, and they need to reach the subscription page
   * to do it. Shutting them out at the door leaves them with no route back.
   */
  readonly isLocked = computed(() => {
    const status = this.subscription()?.status;
    return status === 'suspended' || status === 'expired';
  });

  /** Distinguishes the two so the explanation can differ. */
  readonly lockReason = computed<'suspended' | 'expired' | null>(() => {
    const status = this.subscription()?.status;
    return status === 'suspended' || status === 'expired' ? status : null;
  });

  /** Metrics at or past their ceiling, used to drive upgrade prompts. */
  readonly breachedMetrics = computed(() =>
    this.isUnrestricted()
      ? []
      : this.usage().filter((metric) => metric.severity === 'exceeded'),
  );

  load(): void {
    // A Super Admin has no tenant of their own, so this would 404 on every page
    // load. Only fetch when there is a tenant to fetch for: their own (Admin,
    // Employee) or the one they are scoped to.
    if (this.auth.isSuperAdmin() && this.scope.selectedId() === null) {
      this.snapshot.set(null);
      this.failed.set(false);
      this.loaded.set(true);
      return;
    }

    this.subscriptionService.getEntitlements().subscribe({
      next: (snapshot) => {
        this.snapshot.set(snapshot);
        this.failed.set(false);
        this.loaded.set(true);
      },
      // A failed fetch must not lock the user out of the whole app. It is
      // recorded as a *failure* rather than as "loaded with nothing", because
      // those two need opposite answers from `hasFeature`.
      error: () => {
        this.snapshot.set(null);
        this.failed.set(true);
        this.loaded.set(true);
      },
    });
  }

  /**
   * Whether the plan includes a module.
   *
   * Three states, not two, and the distinction matters more than it looks:
   *
   * - **Loading** → `true`, so the shell does not flash-hide navigation.
   * - **Loaded** → whatever the plan says.
   * - **Failed** → `true`, deliberately.
   *
   * That last one used to answer `false`, and it is what made whole sections of
   * the app vanish: a failed entitlements fetch left `loaded` true with no
   * snapshot, so every module read as excluded. The sidebar dropped Contacts,
   * Import, Groups and Tags, and `featureGuard` bounced anyone who typed the
   * URL — all of it looking like a permissions problem rather than a failed
   * request.
   *
   * Failing open is the right call here because the API enforces entitlements
   * anyway. The worst case is a user reaching a screen that then reports the
   * real error; the alternative silently removes features they are paying for.
   */
  hasFeature(module: FeatureModule): boolean {
    if (this.isUnrestricted()) {
      return true;
    }
    const snapshot = this.snapshot();
    if (snapshot === null) {
      return !this.loaded() || this.failed();
    }
    return snapshot.modules[module];
  }

  usageFor(key: UsageMetricKey): UsageView | null {
    return this.usageByKey().get(key) ?? null;
  }

  /** True when a metric has hit its ceiling and the action should be blocked. */
  hasReachedLimit(key: UsageMetricKey): boolean {
    return !this.isUnrestricted() && this.usageFor(key)?.severity === 'exceeded';
  }
}
