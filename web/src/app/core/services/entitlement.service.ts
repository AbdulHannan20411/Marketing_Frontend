import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import type { FeatureModule } from '@core/models/permission.model';
import type { ApiError } from '@core/models/api.model';
import { radiusOptionsFor } from '@core/models/business-discovery.model';
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
   * The API said this workspace has no subscription.
   *
   * `GET /subscription/entitlements` answers **404** for a workspace that has
   * never bought a plan — `LoadSubscriptionAsync` throws
   * `NotFoundException("This organisation has no subscription.")`. To
   * `HttpClient` that is an error like any other, and both of this service's
   * error paths deliberately fail *open* so a dropped request cannot lock a
   * paying customer out. The result was that the one state which should grant
   * nothing granted everything: no plan, no lock, every module enabled.
   *
   * So a 404 is kept apart from every other failure. It is an answer — "there
   * is no plan" — not a missing answer.
   */
  private readonly noPlan = signal(false);

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
  readonly isLocked = computed(() => this.lockReason() !== null);

  /**
   * Why the workspace is locked, or null when it is not.
   *
   * Four states, and the two that were missing are the ones that mattered:
   *
   * - **`none`** — the entitlement read succeeded and there is no subscription
   *   at all. A workspace that has never bought a plan had full use of the
   *   product: contacts, imports, campaigns, everything. That is the bug this
   *   exists to close.
   * - **`cancelled`** — bought once, cancelled since. Same position as never
   *   having bought one.
   * - `expired` and `suspended`, as before.
   *
   * **A failed read never locks.** `failed` is the difference between "the API
   * says there is no plan" and "the API did not answer", and locking a paying
   * customer out over a dropped request would be a worse bug than the one
   * being fixed. Same for the moment before the answer arrives.
   */
  readonly lockReason = computed<'suspended' | 'expired' | 'cancelled' | 'none' | null>(() => {
    if (this.isUnrestricted() || !this.loaded() || this.failed()) {
      return null;
    }

    if (this.noPlan()) {
      return 'none';
    }

    /*
     * A missing status is 'none', however it goes missing.
     *
     * `== null` rather than `=== undefined` on purpose. The type says the
     * field is always one of five strings, but the backend briefly served
     * `status: null` for a workspace with no plan and could again — and a
     * strict `=== undefined` would have let that fall through to the
     * comparisons below, all false, and reported the workspace as unlocked.
     * That is precisely the bug this whole computed exists to close, so it is
     * not worth leaving to a contract detail on the other side of the wire.
     */
    const status = this.subscription()?.status;
    if (status == null) {
      return 'none';
    }
    return status === 'suspended' || status === 'expired' || status === 'cancelled'
      ? status
      : null;
  });

  /**
   * Whether the plan sells nearby-business search at all.
   *
   * Not a module of its own — it sits inside CRM and is bounded by
   * `maxSearchRadiusKm`, where `0` means the plan does not include it. A plan
   * with CRM and a zero radius passes `hasFeature('crm')` and still cannot
   * search, so the two questions are asked separately.
   */
  readonly hasBusinessSearch = computed(() => {
    if (this.isUnrestricted()) {
      return true;
    }
    if (this.noPlan() || !this.hasFeature('crm')) {
      return false;
    }
    return radiusOptionsFor(this.limits()?.maxSearchRadiusKm).length > 0;
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
        this.noPlan.set(false);
        this.loaded.set(true);
      },
      /*
       * Three outcomes, not two.
       *
       * A 404 is the API telling us there is no subscription, and that has to
       * grant nothing. Any other failure is the API not telling us anything,
       * and that must not lock the workspace — see `noPlan`.
       */
      error: (error: ApiError) => {
        /*
         * `no_subscription` first, the status second.
         *
         * The API now names the reason, which is what makes this
         * unambiguous: a bare 404 on any route is also what a renamed path or
         * a version bump produces, and those are "unknown" — fail open —
         * while this one is "no plan" — lock.
         *
         * The status is still honoured as a fallback rather than dropped. The
         * path is a constant in this service, so it cannot be misspelled at
         * runtime, and an API old enough to answer 404 without the code is an
         * API this client has already shipped against. Dropping it would fail
         * open there, which is the bug this whole line exists to close.
         */
        const missing = error.errorCode === 'no_subscription' || error.status === 404;
        this.snapshot.set(null);
        this.noPlan.set(missing);
        this.failed.set(!missing);
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
    // No plan, no modules. This is the state a new workspace is in, and it is
    // the one that used to answer `true` to everything.
    if (this.noPlan()) {
      return false;
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
