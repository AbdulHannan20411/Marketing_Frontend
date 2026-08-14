import type { BillingCycle } from './subscription.model';

/* ------------------------------------------------------------------ *
 * Manual payment
 *
 * There is no payment processor. The customer transfers the money out of band
 * — JazzCash, EasyPaisa or a bank transfer — uploads a screenshot as proof,
 * and a platform administrator approves or rejects it. The plan only changes
 * on approval, so nothing here grants access on its own.
 * ------------------------------------------------------------------ */

/** Wire values. Each maps to one set of account details and one QR code. */
export type PaymentChannel = 'jazzCash' | 'easyPaisa' | 'bankTransfer';

export const PAYMENT_CHANNEL_LABELS: Readonly<Record<PaymentChannel, string>> = {
  jazzCash: 'JazzCash',
  easyPaisa: 'EasyPaisa',
  bankTransfer: 'Bank transfer',
};

export function paymentChannelLabel(channel: PaymentChannel): string {
  return PAYMENT_CHANNEL_LABELS[channel] ?? channel;
}

/**
 * Where to send the money, as configured by the platform.
 *
 * Served by the API rather than hard-coded, because account numbers change and
 * a stale one in the bundle means money going nowhere.
 */
export interface PaymentChannelDetails {
  readonly channel: PaymentChannel;
  readonly displayName: string;
  readonly accountTitle: string;
  /** Mobile wallet number, or IBAN for a bank transfer. */
  readonly accountNumber: string;
  /** Bank name; empty for the wallet channels. */
  readonly bankName: string;
  /** Absolute or API-relative URL of the QR image. */
  readonly qrImageUrl: string;
  readonly instructions: readonly string[];
  readonly isActive: boolean;
}

/** Editable fields of a channel. The channel itself is fixed by the enum. */
export interface UpdatePaymentChannel {
  readonly displayName: string;
  readonly accountTitle: string;
  readonly accountNumber: string;
  /** Blank marks it a wallet rather than a bank. */
  readonly bankName: string;
  readonly instructions: readonly string[];
  readonly isActive: boolean;
}

export const MAX_QR_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_QR_ACCEPT_ATTR = 'image/png,image/jpeg,image/webp';

/** Returns the reason a QR image cannot be uploaded, or `null`. */
export function qrRejectionReason(file: File): string | null {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
    return `${file.name} is not a PNG, JPG or WEBP.`;
  }
  if (file.size > MAX_QR_BYTES) {
    return `${file.name} is ${describeProofSize(file.size)}. The limit is ${describeProofSize(MAX_QR_BYTES)}.`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentRequestStatus, string>> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
};

export function isPaymentRequestOpen(status: PaymentRequestStatus): boolean {
  return status === 'pending';
}

/**
 * A submitted payment awaiting, or having received, a decision.
 *
 * The reviewer fields are populated only once a decision has been made, and
 * `rejectionReason` only on rejection — the customer is always told why.
 */
export interface PaymentRequest {
  readonly id: string;
  readonly status: PaymentRequestStatus;

  readonly planId: string;
  readonly planName: string;
  readonly billingCycle: BillingCycle;
  readonly amount: number;
  readonly currency: string;

  readonly channel: PaymentChannel;
  /** Transaction id the customer copied from their wallet receipt; may be empty. */
  readonly reference: string;
  readonly note: string;

  /** Authenticated endpoint — fetch as a blob, never as a plain `<img src>`. */
  readonly proofUrl: string;
  readonly proofFileName: string;
  readonly proofContentType: string;

  /** Who paid. Populated for the platform queue; the customer already knows. */
  readonly organisation: string;
  readonly submittedByName: string;
  readonly submittedByEmail: string;
  /** Identifies the admin account for Super Admin scoping. */
  readonly adminId: string | null;

  readonly submittedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly rejectionReason: string | null;
}

/** Everything the customer chose, minus the file, which rides as multipart. */
export interface SubmitPaymentRequest {
  readonly planId: string;
  readonly billingCycle: BillingCycle;
  readonly channel: PaymentChannel;
  readonly reference: string;
  readonly note: string;
}

export interface RejectPaymentRequest {
  readonly reason: string;
}

/* ------------------------------------------------------------------ *
 * Realtime
 * ------------------------------------------------------------------ */

/**
 * Pushed when a request is submitted or decided.
 *
 * Both audiences use it: the platform queue gains a row, and the customer who
 * submitted it sees their status change without reloading.
 */
export interface PaymentRequestEvent {
  readonly requestId: string;
  readonly status: PaymentRequestStatus;
  readonly planName: string;
  readonly organisation: string;
  readonly rejectionReason: string | null;
}

/* ------------------------------------------------------------------ *
 * Proof constraints
 *
 * Mirrored from the API so a hopeless file is refused before it is uploaded.
 * The server remains the authority.
 * ------------------------------------------------------------------ */

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_PROOF_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'];
export const ACCEPTED_PROOF_ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,application/pdf';

export function describeProofSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns the reason a proof file cannot be sent, or `null`. */
export function proofRejectionReason(file: File): string | null {
  const name = file.name.toLowerCase();
  const allowed = ACCEPTED_PROOF_EXTENSIONS.some((extension) => name.endsWith(extension));

  if (!allowed) {
    return `${file.name} is not a PNG, JPG, WEBP or PDF.`;
  }
  if (file.size > MAX_PROOF_BYTES) {
    return `${file.name} is ${describeProofSize(file.size)}. The limit is ${describeProofSize(MAX_PROOF_BYTES)}.`;
  }
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }
  return null;
}
