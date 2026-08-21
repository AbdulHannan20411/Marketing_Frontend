import type { CampaignRunStatus, CampaignStatus } from '@core/models/campaign.model';
import type { TemplateStatus } from '@core/models/whatsapp.model';
import type { BadgeTone } from './badge.component';

export const CAMPAIGN_STATUS_TONE: Readonly<Record<CampaignStatus, BadgeTone>> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'brand',
  completed: 'success',
  paused: 'warning',
  failed: 'danger',
};

export const CAMPAIGN_STATUS_LABEL: Readonly<Record<CampaignStatus, string>> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  completed: 'Completed',
  paused: 'Paused',
  failed: 'Failed',
};

/**
 * `skipped` is deliberately neutral, not red.
 *
 * A skipped run did not go wrong — it is a missed occurrence collapsed by the
 * catch-up policy, or one with nobody to send to. Styling it as an error has
 * operators chasing incidents that never happened.
 */
export const RUN_STATUS_TONE: Readonly<Record<CampaignRunStatus, BadgeTone>> = {
  pending: 'neutral',
  running: 'brand',
  completed: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

export const TEMPLATE_STATUS_TONE: Readonly<Record<TemplateStatus, BadgeTone>> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
  paused: 'neutral',
};
