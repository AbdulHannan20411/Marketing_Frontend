import type { RecurrenceRule } from './recurrence.model';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'completed'
  | 'paused'
  | 'failed';

export interface CampaignMetrics {
  readonly audienceSize: number;
  readonly sent: number;
  readonly delivered: number;
  readonly read: number;
  readonly clicked: number;
  readonly failed: number;
  /** Deliberately not messaged: opted out, over a plan limit, or past the tier. */
  readonly skipped?: number;
}

/**
 * One firing of a campaign.
 *
 * A recurring campaign is not one send but many, so each occurrence carries its
 * own counters. `Campaign.metrics` is the lifetime total across all of these.
 */
export type CampaignRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface CampaignRun {
  readonly id: string;
  readonly campaignId: string;
  /** 1-based and monotonic. Counts skipped occurrences, so it tracks the schedule. */
  readonly occurrenceNumber: number;
  readonly status: CampaignRunStatus;
  /** True when started from "Run now" rather than by the schedule. */
  readonly triggeredManually: boolean;
  /** When this occurrence was due. For a manual run, when it was requested. */
  readonly scheduledFor: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** Set when failed or skipped. Written to be shown to an operator. */
  readonly failureReason: string | null;
  readonly metrics: CampaignMetrics;
}

/**
 * A skipped run is not an error.
 *
 * It is a missed occurrence collapsed by the catch-up policy, or one with
 * nobody to send to. Styling it as a failure sends operators chasing incidents
 * that did not happen.
 */
export const RUN_STATUS_LABELS: Readonly<Record<CampaignRunStatus, string>> = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};

export interface Campaign {
  readonly id: string;
  readonly name: string;
  readonly templateName: string;
  readonly status: CampaignStatus;
  readonly metrics: CampaignMetrics;
  readonly audienceLabel: string;
  readonly scheduledAt: string | null;
  readonly completedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;

  /* ---------------------------------------------------------------- *
   * Fields the editor needs back.
   *
   * The list endpoint returns display strings — `templateName`,
   * `audienceLabel` — which are enough to render a table but not enough to
   * reopen a campaign for editing. These carry the ids and the schedule so
   * the form can be rehydrated.
   *
   * They are optional because the API does not return them yet; see
   * `docs/API-CAMPAIGN-SCHEDULING.md`. Every reader treats a missing value as
   * "unknown" rather than "empty", so the UI degrades to read-only instead of
   * silently saving a campaign with its audience stripped out.
   * ---------------------------------------------------------------- */
  readonly description?: string;
  readonly templateId?: string;
  readonly groupIds?: readonly string[];
  readonly recurrence?: RecurrenceRule | null;
  readonly updatedAt?: string;

  /**
   * Schedule state, maintained by the dispatcher.
   *
   * `nextRunAt` and `lastRunAt` are UTC instants; render them in `timeZone`,
   * not the browser's, or an operator sees a time that does not match the
   * schedule they set. They shift by an hour across a clock change, which is
   * correct — the local time is what stays fixed.
   */
  readonly timeZone?: string;
  readonly nextRunAt?: string | null;
  readonly lastRunAt?: string | null;
  readonly occurrencesRun?: number;
  /**
   * There is deliberately no `pauseReason` here.
   *
   * A campaign can reach `paused` without anyone pressing Pause — a template
   * Meta withdrew, a disconnected number, a plan ceiling — but the explanation
   * is recorded on the **run** that could not go out, as the `failureReason` of
   * a `skipped` run. See `pauseReason()` in the detail component.
   */
}

export type FailureReason =
  | 'Invalid phone number'
  | 'Recipient opted out'
  | 'Template paused by Meta'
  | 'Rate limit exceeded'
  | 'Message undeliverable';

export interface DeliveryFailure {
  readonly id: string;
  readonly campaignName: string;
  readonly contactName: string;
  readonly phoneNumber: string;
  readonly reason: FailureReason;
  readonly errorCode: number;
  readonly occurredAt: string;
}
