/**
 * Deactivating a workspace.
 *
 * This is the tenant owner switching the whole workspace off — not a user
 * closing their personal login. Everyone in it loses access, so the wording
 * everywhere says "workspace", never "your account": an admin who thinks they
 * are removing themselves would be surprised to find they had signed out their
 * whole team.
 *
 * Deliberately **reversible**. Permanent deletion is a different, unrecoverable
 * operation and is not offered here — a self-service button that destroys a
 * customer's data forever is a support ticket waiting to happen.
 */

export type DeactivationReasonId =
  | 'too_expensive'
  | 'missing_features'
  | 'switching_provider'
  | 'no_longer_needed'
  | 'temporary_pause'
  | 'other';

export interface DeactivationReason {
  readonly id: DeactivationReasonId;
  readonly label: string;
}

/**
 * Offered in the picker.
 *
 * Kept short and honest. "Temporary pause" is included because it is a common
 * real answer, and hiding it would push those users into picking something that
 * misrepresents why they left — which makes the churn data worse, not better.
 */
export const DEACTIVATION_REASONS: readonly DeactivationReason[] = [
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'missing_features', label: 'Missing features we need' },
  { id: 'switching_provider', label: 'Moving to another product' },
  { id: 'no_longer_needed', label: 'No longer running WhatsApp marketing' },
  { id: 'temporary_pause', label: 'Pausing for now — we plan to come back' },
  { id: 'other', label: 'Something else' },
];

export interface DeactivateWorkspaceRequest {
  readonly reason: DeactivationReasonId;
  /** Free text. Required when the reason is `other`, optional otherwise. */
  readonly details: string | null;
  /**
   * Confirms the person at the keyboard is the account holder.
   *
   * The same bar as changing the email or the password: a session left open on
   * a shared machine must not be enough to switch off a company's workspace.
   */
  readonly currentPassword: string;
}

export interface DeactivateWorkspaceResult {
  /** When access ends. Immediate today, but the server decides. */
  readonly deactivatedAt: string;
  /**
   * When the data is permanently deleted if nobody reactivates.
   *
   * Shown to the user so "deactivated" does not read as "gone". Null means the
   * server made no promise, and the UI then says nothing rather than inventing
   * a retention period.
   */
  readonly dataRetainedUntil: string | null;
}
