import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { Campaign } from '@core/models/campaign.model';
import { ApiService } from './api.service';

export interface CampaignDraft {
  readonly name: string;
  /** Must reference an **approved** template; the API rejects anything else. */
  readonly templateId: string;
  readonly audienceLabel: string;
  readonly groupIds?: readonly string[];
  /** Handle from `POST /whatsapp/media`, when the template has a media header. */
  readonly mediaId?: string | null;
  /** ISO timestamp; omitted to send as soon as the campaign is started. */
  readonly scheduledAt?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CampaignsService {
  private readonly api = inject(ApiService);

  list(): Observable<readonly Campaign[]> {
    return this.api.get<readonly Campaign[]>('/campaigns');
  }

  create(draft: CampaignDraft): Observable<Campaign> {
    return this.api.post<Campaign, CampaignDraft>('/campaigns', draft);
  }

  update(id: string, draft: Partial<CampaignDraft>): Observable<Campaign> {
    return this.api.put<Campaign, Partial<CampaignDraft>>(`/campaigns/${id}`, draft);
  }

  remove(id: string): Observable<null> {
    return this.api.delete(`/campaigns/${id}`);
  }

  /** `scheduledAt` must be a future UTC instant. */
  schedule(id: string, scheduledAt: string): Observable<Campaign> {
    return this.api.post<Campaign>(`/campaigns/${id}/schedule`, { scheduledAt });
  }

  /**
   * Returns immediately with `status: 'sending'` — the dispatcher runs on a
   * one-minute cadence, so this is not a completed send. Safe to retry: sending
   * an already-started campaign is a no-op returning current state.
   */
  send(id: string): Observable<Campaign> {
    return this.api.post<Campaign>(`/campaigns/${id}/send`);
  }

  pause(id: string): Observable<Campaign> {
    return this.api.post<Campaign>(`/campaigns/${id}/pause`);
  }

  /** Cancelling lands the campaign in `failed` — there is no `cancelled` status. */
  cancel(id: string): Observable<Campaign> {
    return this.api.post<Campaign>(`/campaigns/${id}/cancel`);
  }
}
