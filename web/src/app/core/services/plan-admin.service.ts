import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { environment } from '@env/environment';
import type { ApiResponse } from '@core/models/api.model';
import type { SubscriptionPlan } from '@core/models/subscription.model';
import { ApiService } from './api.service';

/** Payload for creating or updating a plan — the server owns `id` and `updatedAt`. */
export type PlanDraft = Omit<SubscriptionPlan, 'id' | 'updatedAt'>;

@Injectable({ providedIn: 'root' })
export class PlanAdminService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  /** Includes archived and inactive plans, unlike the customer-facing list. */
  list(): Observable<readonly SubscriptionPlan[]> {
    return this.api.get<readonly SubscriptionPlan[]>('/admin/plans');
  }

  create(draft: PlanDraft): Observable<SubscriptionPlan> {
    return this.api.post<SubscriptionPlan, PlanDraft>('/admin/plans', draft);
  }

  update(id: string, draft: Partial<PlanDraft>): Observable<SubscriptionPlan> {
    return this.http
      .put<ApiResponse<SubscriptionPlan>>(`${this.baseUrl}/admin/plans/${id}`, draft)
      .pipe(map((response) => response.data));
  }

  duplicate(id: string): Observable<SubscriptionPlan> {
    return this.api.post<SubscriptionPlan>(`/admin/plans/${id}/duplicate`);
  }

  remove(id: string): Observable<null> {
    return this.http
      .delete<ApiResponse<null>>(`${this.baseUrl}/admin/plans/${id}`)
      .pipe(map((response) => response.data));
  }
}
