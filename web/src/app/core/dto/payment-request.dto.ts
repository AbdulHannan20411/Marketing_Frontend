import type {
  PaymentChannel,
  PaymentChannelDetails,
  PaymentRequest,
  PaymentRequestEvent,
  PaymentRequestStatus,
} from '@core/models/payment-request.model';
import type { BillingCycle } from '@core/models/subscription.model';

/* ------------------------------------------------------------------ *
 * Wire shapes
 *
 * PascalCase enums, matching the contact-import module. Nothing outside this
 * file sees them — the service maps straight into the domain models.
 * ------------------------------------------------------------------ */

export type PaymentChannelDto = 'JazzCash' | 'EasyPaisa' | 'BankTransfer';
export type PaymentRequestStatusDto = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type BillingCycleDto = 'Monthly' | 'Yearly';

export interface PaymentChannelDetailsDto {
  readonly channel: PaymentChannelDto;
  readonly displayName: string;
  readonly accountTitle: string;
  readonly accountNumber: string;
  readonly bankName: string | null;
  readonly qrImageUrl: string;
  readonly instructions: readonly string[];
  readonly isActive: boolean;
}

export interface PaymentRequestDto {
  readonly id: string;
  readonly status: PaymentRequestStatusDto;
  readonly planId: string;
  readonly planName: string;
  readonly billingCycle: BillingCycleDto;
  readonly amount: number;
  readonly currency: string;
  readonly channel: PaymentChannelDto;
  readonly reference: string | null;
  readonly note: string | null;
  readonly proofUrl: string;
  readonly proofFileName: string;
  readonly proofContentType: string;
  readonly organisation: string;
  readonly submittedByName: string;
  readonly submittedByEmail: string;
  readonly adminId: string | null;
  readonly submittedAt: string;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly rejectionReason: string | null;
}

export interface RejectPaymentRequestDto {
  readonly reason: string;
}

export interface UpdatePaymentChannelDto {
  readonly displayName: string;
  readonly accountTitle: string;
  readonly accountNumber: string;
  readonly bankName: string | null;
  readonly instructions: readonly string[];
  readonly isActive: boolean;
}

/** Pushed over SignalR on submission and on each decision. */
export interface PaymentRequestNotificationDto {
  readonly requestId: string;
  readonly status: PaymentRequestStatusDto;
  readonly planName: string;
  readonly organisation: string;
  readonly rejectionReason: string | null;
}

/* ------------------------------------------------------------------ *
 * Mappers
 * ------------------------------------------------------------------ */

const CHANNEL: Readonly<Record<PaymentChannelDto, PaymentChannel>> = {
  JazzCash: 'jazzCash',
  EasyPaisa: 'easyPaisa',
  BankTransfer: 'bankTransfer',
};

const CHANNEL_WIRE: Readonly<Record<PaymentChannel, PaymentChannelDto>> = {
  jazzCash: 'JazzCash',
  easyPaisa: 'EasyPaisa',
  bankTransfer: 'BankTransfer',
};

const STATUS: Readonly<Record<PaymentRequestStatusDto, PaymentRequestStatus>> = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
};

const STATUS_WIRE: Readonly<Record<PaymentRequestStatus, PaymentRequestStatusDto>> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const CYCLE: Readonly<Record<BillingCycleDto, BillingCycle>> = {
  Monthly: 'monthly',
  Yearly: 'yearly',
};

const CYCLE_WIRE: Readonly<Record<BillingCycle, BillingCycleDto>> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/**
 * An unrecognised status is treated as still pending rather than decided: it
 * keeps the request in the reviewer's queue instead of quietly granting or
 * denying a plan on a value we do not understand.
 */
function toStatus(value: PaymentRequestStatusDto): PaymentRequestStatus {
  return STATUS[value] ?? 'pending';
}

export function toPaymentChannelDto(channel: PaymentChannel): PaymentChannelDto {
  return CHANNEL_WIRE[channel];
}

/** Filters go back over the wire in the API's casing; `all` passes through. */
export function toStatusFilterDto(status: PaymentRequestStatus | 'all'): string {
  return status === 'all' ? 'all' : STATUS_WIRE[status];
}

export function toPaymentChannelDetails(dto: PaymentChannelDetailsDto): PaymentChannelDetails {
  return {
    channel: CHANNEL[dto.channel] ?? 'bankTransfer',
    displayName: dto.displayName,
    accountTitle: dto.accountTitle,
    accountNumber: dto.accountNumber,
    bankName: dto.bankName ?? '',
    qrImageUrl: dto.qrImageUrl,
    instructions: dto.instructions,
    isActive: dto.isActive,
  };
}

export function toPaymentRequest(dto: PaymentRequestDto): PaymentRequest {
  return {
    id: dto.id,
    status: toStatus(dto.status),
    planId: dto.planId,
    planName: dto.planName,
    billingCycle: CYCLE[dto.billingCycle] ?? 'monthly',
    amount: dto.amount,
    currency: dto.currency,
    channel: CHANNEL[dto.channel] ?? 'bankTransfer',
    reference: dto.reference ?? '',
    note: dto.note ?? '',
    proofUrl: dto.proofUrl,
    proofFileName: dto.proofFileName,
    proofContentType: dto.proofContentType,
    organisation: dto.organisation,
    submittedByName: dto.submittedByName,
    submittedByEmail: dto.submittedByEmail,
    adminId: dto.adminId,
    submittedAt: dto.submittedAt,
    reviewedAt: dto.reviewedAt,
    reviewedBy: dto.reviewedBy,
    rejectionReason: dto.rejectionReason,
  };
}

export function toPaymentRequestEvent(dto: PaymentRequestNotificationDto): PaymentRequestEvent {
  return {
    requestId: dto.requestId,
    status: toStatus(dto.status),
    planName: dto.planName,
    organisation: dto.organisation,
    rejectionReason: dto.rejectionReason ?? null,
  };
}

export function toBillingCycleDto(cycle: BillingCycle): BillingCycleDto {
  return CYCLE_WIRE[cycle];
}
