import { Injectable, inject } from '@angular/core';
import { tap, type Observable } from 'rxjs';

import type {
  AddPaymentMethodRequest,
  BillingHistory,
  BillingProfile,
  CancelSubscriptionRequest,
  EntitlementSnapshot,
  ChangePlanRequest,
  Invoice,
  PaymentMethod,
  SubscriptionPlan,
  SubscriptionSnapshot,
} from '@core/models/subscription.model';
import { ApiService } from './api.service';
import { saveBlob } from './contacts.service';

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly api = inject(ApiService);

  /** 404 when the tenant has no subscription — render a "choose a plan" state. */
  getSnapshot(): Observable<SubscriptionSnapshot> {
    return this.api.get<SubscriptionSnapshot>('/subscription');
  }

  /** Purchasable plans; archived ones are excluded server-side. */
  listPlans(): Observable<readonly SubscriptionPlan[]> {
    return this.api.get<readonly SubscriptionPlan[]>('/plans');
  }

  /** Downgrades below current usage are refused with `downgrade_blocked`. */
  changePlan(request: ChangePlanRequest): Observable<SubscriptionSnapshot> {
    return this.api.post<SubscriptionSnapshot, ChangePlanRequest>(
      '/subscription/change-plan',
      request,
    );
  }

  /**
   * What the plan allows, without the billing detail.
   *
   * Separate from `getSnapshot()` because this one needs no permission: the
   * shell loads it for every user on every page, and gating it behind
   * `settings.subscription` gave employees a 403 on every page load and left
   * every plan-gated feature falling back to its unknown state.
   */
  getEntitlements(): Observable<EntitlementSnapshot> {
    return this.api.get<EntitlementSnapshot>('/subscription/entitlements');
  }

  cancel(request: CancelSubscriptionRequest = {}): Observable<SubscriptionSnapshot> {
    return this.api.post<SubscriptionSnapshot, CancelSubscriptionRequest>(
      '/subscription/cancel',
      request,
    );
  }

  resume(): Observable<SubscriptionSnapshot> {
    return this.api.post<SubscriptionSnapshot>('/subscription/resume');
  }

  setAutoRenew(enabled: boolean): Observable<SubscriptionSnapshot> {
    return this.api.post<SubscriptionSnapshot>('/subscription/auto-renew', { enabled });
  }

  /* ------------------------------ billing ------------------------------ */

  getBillingHistory(): Observable<BillingHistory> {
    return this.api.get<BillingHistory>('/billing/history');
  }

  /** Send an Idempotency-Key upstream; the API honours it. */
  payInvoice(id: string): Observable<Invoice> {
    return this.api.post<Invoice>(`/billing/invoices/${id}/pay`);
  }

  /** The renderer is not implemented server-side yet and returns 501. */
  downloadInvoice(id: string, number: string): Observable<Blob> {
    return this.api
      .download(`/billing/invoices/${id}/pdf`)
      .pipe(tap((blob) => saveBlob(blob, `${number}.pdf`)));
  }

  listPaymentMethods(): Observable<readonly PaymentMethod[]> {
    return this.api.get<readonly PaymentMethod[]>('/billing/payment-methods');
  }

  /** Takes a processor token — raw card details are rejected. */
  addPaymentMethod(request: AddPaymentMethodRequest): Observable<PaymentMethod> {
    return this.api.post<PaymentMethod, AddPaymentMethodRequest>(
      '/billing/payment-methods',
      request,
    );
  }

  removePaymentMethod(id: string): Observable<null> {
    return this.api.delete(`/billing/payment-methods/${id}`);
  }

  setDefaultPaymentMethod(id: string): Observable<PaymentMethod> {
    return this.api.put<PaymentMethod>(`/billing/payment-methods/${id}/default`);
  }

  getBillingProfile(): Observable<BillingProfile> {
    return this.api.get<BillingProfile>('/billing/profile');
  }

  updateBillingProfile(profile: BillingProfile): Observable<BillingProfile> {
    return this.api.put<BillingProfile, BillingProfile>('/billing/profile', profile);
  }
}
