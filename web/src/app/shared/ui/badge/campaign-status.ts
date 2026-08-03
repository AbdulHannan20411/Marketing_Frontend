import type { CampaignStatus } from '@core/models/campaign.model';
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

export const TEMPLATE_STATUS_TONE: Readonly<Record<TemplateStatus, BadgeTone>> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
  paused: 'neutral',
};
