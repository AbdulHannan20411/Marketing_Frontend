import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  BillingHistory,
  SubscriptionPlan,
  SubscriptionSnapshot,
} from '@core/models/subscription.model';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly api = inject(ApiService);

  getSnapshot(): Observable<SubscriptionSnapshot> {
    return this.api.get<SubscriptionSnapshot>('/subscription');
  }

  /** Publicly purchasable plans; archived ones are excluded server-side. */
  listPlans(): Observable<readonly SubscriptionPlan[]> {
    return this.api.get<readonly SubscriptionPlan[]>('/plans');
  }

  getBillingHistory(): Observable<BillingHistory> {
    return this.api.get<BillingHistory>('/billing/history');
  }
}
