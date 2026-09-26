import { Injectable, computed, inject, signal } from '@angular/core';

import type { FeatureModule } from '@core/models/permission.model';
import { EntitlementService } from './entitlement.service';

/** Why an action was stopped, which decides what the prompt offers. */
export type PlanGateReason = 'purchase' | 'upgrade';

export interface PlanGateRequest {
  readonly reason: PlanGateReason;
  /**
   * What the person was trying to do — "Creating a tag", "Importing
   * contacts". Null when the refusal came from the API, which reports the
   * code per refusal and leaves the sentence to whoever knows the action.
   */
  readonly action: string | null;
  /** The module it needs, when it needs one. */
  readonly module: FeatureModule | null;
}

/** What a caller is about to do, and what the plan must include for it. */
export interface PlanGatedAction {
  readonly action: string;
  readonly module?: FeatureModule;
  /**
   * A further condition the plan has to satisfy, beyond including the module.
   *
   * Some things are sold *inside* a module rather than as one. Nearby-business
   * search belongs to CRM, but a plan can set its radius to zero and not sell
   * it; auto-reply occasions are sold separately from the AI module. `false`
   * means "the plan has the module but not this part of it" — an upgrade, not
   * a purchase. Omitted means there is nothing more to satisfy.
   */
  readonly included?: boolean;
}

/**
 * Stops an action the plan does not cover, and offers the plan that would.
 *
 * The product decision behind this: **screens stay visible**. Somebody who
 * cannot see contacts, groups or campaigns has no reason to buy them, and a
 * menu that hides two thirds of the product looks broken rather than
 * upgradeable. So everything can be opened and read, and the boundary sits on
 * the actions that change something — where it is also the natural moment to
 * offer the upgrade.
 *
 * **Not a security boundary.** The API must refuse the same work; this exists
 * so the refusal arrives as an offer rather than as an error, and so it
 * arrives before the person has filled in a form.
 */
@Injectable({ providedIn: 'root' })
export class PlanGateService {
  private readonly entitlements = inject(EntitlementService);

  private readonly request = signal<PlanGateRequest | null>(null);

  /** The prompt to show, or null. Rendered once, by the shell. */
  readonly prompt = this.request.asReadonly();

  /**
   * Why a write would be stopped right now, or null when it would go through.
   *
   * `purchase` when there is no usable subscription at all — nothing was ever
   * bought, or it has expired, been cancelled or been suspended. `upgrade`
   * when there is a plan and it simply does not include this module.
   */
  reasonFor(module?: FeatureModule): PlanGateReason | null {
    if (this.entitlements.isUnrestricted()) {
      return null;
    }
    if (this.entitlements.isLocked()) {
      return 'purchase';
    }
    return module !== undefined && !this.entitlements.hasFeature(module) ? 'upgrade' : null;
  }

  /** True when nothing on this screen can be changed. */
  readonly isReadOnly = computed(() => this.entitlements.isLocked());

  /**
   * Whether the action may go ahead.
   *
   * Returns `true` and does nothing when it may. Otherwise it opens the
   * prompt and returns `false`, so the call site reads as one line at the top
   * of the handler:
   *
   * ```ts
   * if (!this.gate.allow({ action: 'Creating a tag', module: 'crm' })) {
   *   return;
   * }
   * ```
   */
  allow(intent: PlanGatedAction): boolean {
    // Locked and missing-module first, because either outranks `included`: a
    // workspace with no plan at all should be asked to buy one, not to upgrade.
    const reason =
      this.reasonFor(intent.module) ?? (intent.included === false ? 'upgrade' : null);
    if (reason === null) {
      return true;
    }

    this.request.set({ reason, action: intent.action, module: intent.module ?? null });
    return false;
  }

  /**
   * Opens the purchase prompt without an action of its own.
   *
   * For the API's own refusal: if a write slips past the check above — a path
   * nobody gated, or a limit only the server knows about — the answer still
   * arrives as an offer rather than as a red toast.
   */
  promptPurchase(action: string | null = null): void {
    this.request.set({
      reason: this.entitlements.isLocked() ? 'purchase' : 'upgrade',
      action,
      module: null,
    });
  }

  dismiss(): void {
    this.request.set(null);
  }
}
