import type { IconName } from '@shared/ui/icon/icon.registry';

export type NotificationPriority = 'critical' | 'warning' | 'info' | 'success';

export type NotificationKind =
  | 'subscription.expiring'
  | 'meta.disconnected'
  | 'whatsapp.token.expiring'
  | 'campaign.completed'
  | 'campaign.failed'
  | 'payment.received'
  | 'payment.failed'
  | 'employee.invited'
  | 'plan.upgraded'
  | 'storage.limit'
  | 'contacts.limit'
  | 'messages.limit';

export interface AppNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly priority: NotificationPriority;
  readonly icon: IconName;
  readonly read: boolean;
  readonly actionLabel: string | null;
  readonly actionRoute: string | null;
  readonly occurredAt: string;
}
