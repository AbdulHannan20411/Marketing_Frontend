import { ICON_PATHS, type IconName } from '@shared/ui/icon/icon.registry';

export type NotificationPriority = 'critical' | 'warning' | 'info' | 'success';

/**
 * Every kind the backend emits.
 *
 * **Not exhaustive by design.** Kinds are added as features land, and a client
 * built before one exists will still be handed it. Nothing in the UI switches
 * on this union — presentation comes from `icon` and `priority` on the payload
 * — so a kind this build has never heard of still renders correctly. See
 * `toNotification`, which is what makes that true rather than hoped for.
 */
export type NotificationKind =
  | 'subscription.expiring'
  | 'meta.disconnected'
  | 'whatsapp.token.expiring'
  | 'campaign.completed'
  | 'campaign.failed'
  | 'payment.received'
  | 'payment.failed'
  | 'payment.submitted'
  | 'payment.approved'
  | 'payment.rejected'
  | 'employee.invited'
  | 'plan.upgraded'
  | 'storage.limit'
  | 'contacts.limit'
  | 'messages.limit'
  // Auto-reply paused: the monthly AI allowance is spent. Presentation still
  // comes from the payload, so listing it here is documentation, not wiring.
  | 'ai.replies.exhausted'
  /** Sign-in from a device this user hasn't used. Action: /account/security. */
  | 'security.new_login'
  /** To workspace admins (new device, new city, sharing signs) or platform staff (high risk). */
  | 'security.alert'
  /** To workspace admins when platform staff suspend one of their people. Action: /settings/security. */
  | 'security.account_suspended';

export interface AppNotification {
  readonly id: string;
  /** Widened to `string`: see {@link NotificationKind}. */
  readonly kind: NotificationKind | string;
  readonly title: string;
  readonly body: string;
  readonly priority: NotificationPriority;
  readonly icon: IconName;
  readonly read: boolean;
  readonly actionLabel: string | null;
  readonly actionRoute: string | null;
  readonly occurredAt: string;
}

/* ------------------------------------------------------------------ *
 * Normalising what the server actually sends
 * ------------------------------------------------------------------ */

/**
 * The payload as it arrives — before anything trusts it.
 *
 * `icon` and `priority` are typed as unions on `AppNotification`, but a union
 * is a claim about the wire, not a guarantee. The server picks these strings,
 * and this build has no say in what it picks.
 */
export interface AppNotificationDto extends Omit<AppNotification, 'icon' | 'priority'> {
  readonly icon: string;
  readonly priority: string;
}

/** Shown when the server names an icon this build does not have. */
const FALLBACK_ICON: IconName = 'bell';

/** Shown when the server sends a priority this build does not know. */
const FALLBACK_PRIORITY: NotificationPriority = 'info';

const PRIORITIES: readonly NotificationPriority[] = ['critical', 'warning', 'info', 'success'];

/**
 * Icon names the server uses that differ from the registry's.
 *
 * The registry is camelCase; the API sends kebab-case for at least
 * `credit-card`. Rather than rename either side, the difference is absorbed
 * here — one place, and the only place that has to know.
 */
function toCamelCase(value: string): string {
  return value.replace(/[-_](.)/g, (_, character: string) => character.toUpperCase());
}

/**
 * Resolves a server-supplied icon name to one this build can draw.
 *
 * **This is not defensive padding.** `ICON_PATHS[name]` is `undefined` for an
 * unknown name and the icon template iterates it, so an unrecognised name is a
 * blank icon at best. The API sends `credit-card` for the payment kinds while
 * the registry calls it `creditCard` — without this, every payment
 * notification would render without one.
 */
export function resolveIcon(name: string): IconName {
  if (name in ICON_PATHS) {
    return name as IconName;
  }
  const camel = toCamelCase(name);
  return camel in ICON_PATHS ? (camel as IconName) : FALLBACK_ICON;
}

export function resolvePriority(value: string): NotificationPriority {
  return PRIORITIES.includes(value as NotificationPriority)
    ? (value as NotificationPriority)
    : FALLBACK_PRIORITY;
}

/**
 * The single seam between the wire and the UI.
 *
 * Everything downstream reads `AppNotification` and can rely on its icon being
 * drawable and its priority being one of four. A kind this build has never
 * seen arrives intact and renders from the server's own icon and priority,
 * which is exactly what stops a new backend feature from turning into a
 * silently missing notification.
 */
export function toNotification(dto: AppNotificationDto): AppNotification {
  return {
    ...dto,
    icon: resolveIcon(dto.icon),
    priority: resolvePriority(dto.priority),
  };
}
