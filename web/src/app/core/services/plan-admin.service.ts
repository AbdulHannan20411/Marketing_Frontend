import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { environment } from '@env/environment';
import {
  pagingParams,
  toAdaptivePage,
  type AdaptivePage,
  type ListQuery,
  type ServerListSupport,
} from '@core/http/adaptive-page';
import type { ApiResponse, PagedResult } from '@core/models/api.model';
import type { SubscriptionPlan } from '@core/models/subscription.model';
import { comparatorFor } from './contacts.service';
import { sortParams, type SortColumn } from '@shared/ui/data-table/sort';
import { ApiService } from './api.service';

/**
 * What `/admin/plans` does for itself: nothing yet.
 *
 * `PlanAdministrationController.GetAsync` is `_plans.GetAllAsync` — no paging,
 * no search, no ordering parameter. The parameters are sent regardless and
 * applied here until they are honoured; see
 * `docs/API-LIST-PAGINATION-BACKEND.md`.
 */
const PLANS_SERVER_SUPPORT: ServerListSupport = { search: false, sort: false };

/** What the plan list can be ordered by. */
export const PLAN_SORT_COLUMNS: readonly SortColumn<SubscriptionPlan>[] = [
  { key: 'id', label: 'ID', kind: 'text', value: (plan) => plan.id },
  { key: 'name', label: 'Name', kind: 'text', value: (plan) => plan.name },
  { key: 'status', label: 'Status', kind: 'text', value: (plan) => plan.status },
  {
    key: 'monthlyPrice',
    label: 'Monthly price',
    kind: 'number',
    value: (plan) => plan.monthlyPrice,
  },
  { key: 'yearlyPrice', label: 'Yearly price', kind: 'number', value: (plan) => plan.yearlyPrice },
  { key: 'sortOrder', label: 'Display order', kind: 'number', value: (plan) => plan.sortOrder },
  {
    key: 'updatedAt',
    label: 'Modified',
    kind: 'date',
    value: (plan) => plan.updatedAt,
    initialDirection: 'desc',
  },
];

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

  /**
   * One page of plans, searched and ordered.
   *
   * `status` is the screen's own tab and is applied alongside the search, so a
   * client-side page narrows before it slices and the total describes what is
   * left rather than what was removed.
   */
  page(query: ListQuery & { readonly status?: string }): Observable<AdaptivePage<SubscriptionPlan>> {
    return this.api
      .get<PagedResult<SubscriptionPlan> | readonly SubscriptionPlan[]>('/admin/plans', {
        ...pagingParams(query, PLANS_SERVER_SUPPORT),
        ...(query.search?.trim() ? { search: query.search.trim() } : {}),
        ...(query.status !== undefined && query.status !== 'all' ? { status: query.status } : {}),
        ...sortParams(query.sortBy, query.sortDirection),
      })
      .pipe(
        map((response) =>
          toAdaptivePage(response, query, {
            matches: (plan, term) =>
              (query.status === undefined ||
                query.status === 'all' ||
                plan.status === query.status) &&
              // The tagline is what tells two similarly named plans apart, and
              // it is on the card.
              (term === '' ||
                plan.name.toLowerCase().includes(term) ||
                plan.tagline.toLowerCase().includes(term)),
            // Display order is the default, because it is the order customers
            // see on the pricing page and the one the cards are arranged in.
            compare: (current) =>
              comparatorFor(PLAN_SORT_COLUMNS, current) ??
              ((left, right) => left.sortOrder - right.sortOrder),
          }),
        ),
      );
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
