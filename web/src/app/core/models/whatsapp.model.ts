export type ConnectionStatus = 'connected' | 'disconnected' | 'pending' | 'error';
export type QualityRating = 'green' | 'yellow' | 'red';

export interface WhatsAppConnection {
  readonly status: ConnectionStatus;
  readonly displayPhoneNumber: string;
  readonly verifiedName: string;
  readonly businessProfileAbout: string;
  readonly businessCategory: string;
  readonly qualityRating: QualityRating;
  /** Rolling 24-hour send ceiling granted by Meta. */
  readonly messagingLimit: number;
  readonly messagesLast24h: number;
  readonly connectedAt: string | null;
  readonly webhookHealthy: boolean;
  readonly templateNamespaceAlias: string;
}

export type TemplateStatus = 'approved' | 'pending' | 'rejected' | 'paused';
export type TemplateCategory = 'marketing' | 'utility' | 'authentication';

export interface MessageTemplate {
  readonly id: string;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly status: TemplateStatus;
  readonly language: string;
  readonly headerText: string | null;
  /** Body copy with `{{1}}`-style placeholders left intact for highlighting. */
  readonly bodyText: string;
  readonly footerText: string | null;
  readonly variables: readonly string[];
  readonly buttons: readonly string[];
  readonly qualityScore: QualityRating;
  readonly timesUsed: number;
  readonly updatedAt: string;
  readonly rejectionReason: string | null;
}
