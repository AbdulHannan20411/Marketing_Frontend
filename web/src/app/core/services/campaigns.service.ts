import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import type { Campaign, CampaignRun } from '@core/models/campaign.model';
import type { RecurrenceRule } from '@core/models/recurrence.model';
import { ApiService } from './api.service';

/** Body of `POST /campaigns/{id}/schedule`. */
export interface SchedulePayload {
  readonly recurrence?: RecurrenceRule | null;
  readonly scheduledAt?: string | null;
}

export interface AudiencePreview {
  /** Deduplicated and opt-out aware — the real number, not an estimate. */
  readonly recipientCount: number;
}

export interface CampaignDraft {
  readonly name: string;
  readonly description?: string;
  /** Must reference an **approved** template; the API rejects anything else. */
  readonly templateId: string;
  readonly audienceLabel: string;
  readonly groupIds?: readonly string[];
  /** Handle from `POST /whatsapp/media`, when the template has a media header. */
  readonly mediaId?: string | null;
  /** ISO timestamp; omitted to send as soon as the campaign is started. */
  readonly scheduledAt?: string | null;
  /**
   * The full schedule, including recurrence and timezone.
   *
   * `scheduledAt` above stays for the existing one-off path the API already
   * understands. This is the richer rule — see the backend note in
   * `docs/API-CAMPAIGN-SCHEDULING.md`; until it lands the API ignores it.
   */
  readonly recurrence?: RecurrenceRule | null;
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

  /**
   * Both forms go up together and the API decides.
   *
   * When `recurrence.frequency` is anything but `once` the rule wins and
   * `scheduledAt` is ignored; when it is `once` the rule still wins, because
   * it carries the timezone and the bare instant does not. Sending both keeps
   * the one-off path working on deployments where recurrence is not live yet.
   *
   * The response already carries `nextRunAt`, so the first firing can be
   * confirmed to the operator without a second call.
   */
  schedule(id: string, payload: SchedulePayload): Observable<Campaign> {
    return this.api.post<Campaign, SchedulePayload>(`/campaigns/${id}/schedule`, payload);
  }

  /**
   * Every firing of a campaign, newest first.
   *
   * A one-off has exactly one; a recurring campaign has one per occurrence,
   * including the ones that were skipped.
   */
  listRuns(id: string, page = 1, pageSize = 20): Observable<PagedResult<CampaignRun>> {
    return this.api.get<PagedResult<CampaignRun>>(`/campaigns/${id}/runs`, { page, pageSize });
  }

  /**
   * Fires a scheduled campaign now **without touching its schedule** — Monday
   * is still Monday, and the manual run does not consume an `afterCount`
   * allowance.
   *
   * Returns the run rather than the campaign, so the history table can prepend
   * it. The idempotency key makes a double-click or a retry harmless; the API
   * also returns any run already `pending` or `running` instead of starting a
   * second one.
   *
   * `409 campaign_not_scheduled` for anything not in `scheduled`.
   */
  runNow(id: string): Observable<CampaignRun> {
    return this.api.post<CampaignRun>(`/campaigns/${id}/run-now`, undefined, undefined, {
      'Idempotency-Key': crypto.randomUUID(),
    });
  }

  /**
   * The true recipient count for a set of groups — deduplicated across them and
   * with opt-outs removed.
   *
   * The wizard falls back to summing `contactCount` when this is unavailable,
   * and labels that sum an estimate, because overlapping groups double-count.
   */
  previewAudience(groupIds: readonly string[]): Observable<AudiencePreview> {
    return this.api.post<AudiencePreview, { groupIds: readonly string[] }>(
      '/campaigns/preview-audience',
      { groupIds },
    );
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

  /* ------------------------------------------------------------------ *
   * Not yet served by the API.
   *
   * Each of these is a single call in one place rather than a branch spread
   * through the components, so wiring them up when the endpoints land is a
   * matter of deleting the comment. The UI surfaces the failure honestly
   * meanwhile instead of pretending the action worked.
   * ------------------------------------------------------------------ */

  /** Resumes a paused campaign. Awaiting `POST /campaigns/{id}/resume`. */
  resume(id: string): Observable<Campaign> {
    return this.api.post<Campaign>(`/campaigns/${id}/resume`);
  }

  /** Copies a campaign as a fresh draft. Awaiting `POST /campaigns/{id}/duplicate`. */
  duplicate(id: string): Observable<Campaign> {
    return this.api.post<Campaign>(`/campaigns/${id}/duplicate`);
  }

  /**
   * A single campaign with its ids and schedule.
   *
   * Awaiting `GET /campaigns/{id}`. Callers fall back to the list, which is
   * enough to display but not to edit.
   */
  getById(id: string): Observable<Campaign> {
    return this.api.get<Campaign>(`/campaigns/${id}`);
  }

  /** Cancelling lands the campaign in `failed` — there is no `cancelled` status. */
  cancel(id: string): Observable<Campaign> {
    return this.api.post<Campaign>(`/campaigns/${id}/cancel`);
  }
}
