import { Injectable, inject } from '@angular/core';
import { tap, type Observable } from 'rxjs';

import type { DashboardSnapshot } from '@core/models/analytics.model';
import type { Campaign } from '@core/models/campaign.model';
import type { DeliveryFailure } from '@core/models/campaign.model';
import type { PagedResult } from '@core/models/api.model';
import { ApiService } from './api.service';
import { saveBlob } from './contacts.service';



@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiService);

  getSnapshot(): Observable<DashboardSnapshot> {
    return this.api.get<DashboardSnapshot>('/dashboard');
  }

  /**
   * The reporting overview.
   *
   * The same shape as the dashboard, and today the same numbers — but gated on
   * `reports.view`, which is the permission the Reports page is guarded by.
   * Reading the dashboard's copy here meant the page's data came through a
   * permission the page itself does not require.
   */
  getReportsOverview(): Observable<DashboardSnapshot> {
    return this.api.get<DashboardSnapshot>('/reports/overview');
  }

  getCampaigns(): Observable<readonly Campaign[]> {
    return this.api.get<readonly Campaign[]>('/campaigns');
  }

  getFailures(page: number, pageSize: number): Observable<PagedResult<DeliveryFailure>> {
    return this.api.get<PagedResult<DeliveryFailure>>('/reports/failures', { page, pageSize });
  }

  /**
   * The failure log as a CSV file.
   *
   * Asks the API to produce it, and falls back to building one here from the
   * paged endpoint when that route does not exist yet.
   *
   * The fallback triggers on **404 only**. Falling back on any error would be
   * worse than failing: a 500 or an expired session would quietly produce a
   * file assembled from whatever the client could still read, and a partial
   * failure log that looks complete is a worse artefact than no file at all.
   */
  /**
   * The failure log as CSV, streamed by the API across the whole result set.
   *
   * This carried a client-side fallback that walked the paged endpoint when
   * `/reports/failures/export` answered 404. The endpoint is live, so the
   * fallback was unreachable code whose only possible effect was to assemble a
   * partial log that looked complete. Removed rather than kept "just in case".
   */
  exportFailures(): Observable<Blob> {
    return this.api
      .download('/reports/failures/export')
      .pipe(tap((blob) => saveBlob(blob, 'delivery-failures.csv')));
  }

}
