import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { DashboardSnapshot } from '@core/models/analytics.model';
import type { Campaign } from '@core/models/campaign.model';
import type { DeliveryFailure } from '@core/models/campaign.model';
import type { PagedResult } from '@core/models/api.model';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiService);

  getSnapshot(): Observable<DashboardSnapshot> {
    return this.api.get<DashboardSnapshot>('/dashboard');
  }

  getCampaigns(): Observable<readonly Campaign[]> {
    return this.api.get<readonly Campaign[]>('/campaigns');
  }

  getFailures(page: number, pageSize: number): Observable<PagedResult<DeliveryFailure>> {
    return this.api.get<PagedResult<DeliveryFailure>>('/reports/failures', { page, pageSize });
  }
}
