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
}

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
