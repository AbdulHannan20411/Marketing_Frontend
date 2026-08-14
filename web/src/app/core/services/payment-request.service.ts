import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type {
  PaymentChannelDetailsDto,
  PaymentRequestDto,
  RejectPaymentRequestDto,
  UpdatePaymentChannelDto,
} from '@core/dto/payment-request.dto';
import {
  toBillingCycleDto,
  toPaymentChannelDetails,
  toPaymentChannelDto,
  toPaymentRequest,
  toStatusFilterDto,
} from '@core/dto/payment-request.dto';
import type { PagedResult } from '@core/models/api.model';
import type {
  PaymentChannel,
  PaymentChannelDetails,
  PaymentRequest,
  PaymentRequestStatus,
  SubmitPaymentRequest,
  UpdatePaymentChannel,
} from '@core/models/payment-request.model';
import { ApiService } from './api.service';

const CUSTOMER_BASE = '/billing/payment-requests';
const PLATFORM_BASE = '/superadmin/payment-requests';

export type PaymentStatusFilter = PaymentRequestStatus | 'all';

function toPagedDomain(page: PagedResult<PaymentRequestDto>): PagedResult<PaymentRequest> {
  return {
    items: page.items.map(toPaymentRequest),
    page: page.page,
    pageSize: page.pageSize,
    totalItems: page.totalItems,
    totalPages: page.totalPages,
  };
}

/**
 * Manual payment: submit proof, then wait for a platform administrator.
 *
 * Nothing here changes a subscription. Submitting records an intent and an
 * uploaded screenshot; the plan moves only when `approve` succeeds, and that
 * endpoint is reachable only by a Super Admin. Keeping the grant on the
 * platform side is the point of the whole flow — a customer who can upload an
 * image must not be able to upgrade themselves.
 */
@Injectable({ providedIn: 'root' })
export class PaymentRequestService {
  private readonly api = inject(ApiService);

  /* ------------------------------ customer ------------------------------ */

  /** Where to send the money. Served by the API so account numbers can change. */
  listChannels(): Observable<readonly PaymentChannelDetails[]> {
    return this.api
      .get<readonly PaymentChannelDetailsDto[]>('/billing/payment-channels')
      .pipe(map((channels) => channels.map(toPaymentChannelDetails)));
  }

  /** Multipart: the proof screenshot plus the choices behind it. */
  submit(request: SubmitPaymentRequest, proof: File): Observable<PaymentRequest> {
    const form = new FormData();
    form.append('planId', request.planId);
    form.append('billingCycle', toBillingCycleDto(request.billingCycle));
    form.append('channel', toPaymentChannelDto(request.channel));
    form.append('reference', request.reference);
    form.append('note', request.note);
    form.append('proof', proof, proof.name);

    return this.api.upload<PaymentRequestDto>(CUSTOMER_BASE, form).pipe(map(toPaymentRequest));
  }

  /** This workspace's own submissions, newest first. */
  listMine(page: number, pageSize: number): Observable<PagedResult<PaymentRequest>> {
    return this.api
      .get<PagedResult<PaymentRequestDto>>(CUSTOMER_BASE, { page, pageSize })
      .pipe(map(toPagedDomain));
  }

  /** The most recent submission, or `null`. Drives the "under review" banner. */
  latestMine(): Observable<PaymentRequest | null> {
    return this.listMine(1, 1).pipe(map((result) => result.items[0] ?? null));
  }

  getMine(id: string): Observable<PaymentRequest> {
    return this.api.get<PaymentRequestDto>(`${CUSTOMER_BASE}/${id}`).pipe(map(toPaymentRequest));
  }

  /** Withdraw a submission that has not been reviewed yet. */
  cancel(id: string): Observable<PaymentRequest> {
    return this.api
      .post<PaymentRequestDto>(`${CUSTOMER_BASE}/${id}/cancel`)
      .pipe(map(toPaymentRequest));
  }

  /* ------------------------------ channel administration ------------------------------ */

  /** Every channel, including inactive ones. Super Admin only. */
  listAllChannels(): Observable<readonly PaymentChannelDetails[]> {
    return this.api
      .get<readonly PaymentChannelDetailsDto[]>('/superadmin/payment-channels')
      .pipe(map((channels) => channels.map(toPaymentChannelDetails)));
  }

  saveChannel(
    channel: PaymentChannel,
    details: UpdatePaymentChannel,
  ): Observable<PaymentChannelDetails> {
    return this.api
      .put<PaymentChannelDetailsDto, UpdatePaymentChannelDto>(
        `/superadmin/payment-channels/${toPaymentChannelDto(channel)}`,
        {
          displayName: details.displayName,
          accountTitle: details.accountTitle,
          accountNumber: details.accountNumber,
          // Blank marks it a wallet rather than a bank.
          bankName: details.bankName.trim() === '' ? null : details.bankName.trim(),
          instructions: details.instructions.filter((line) => line.trim() !== ''),
          isActive: details.isActive,
        },
      )
      .pipe(map(toPaymentChannelDetails));
  }

  uploadChannelQr(channel: PaymentChannel, image: File): Observable<PaymentChannelDetails> {
    const form = new FormData();
    form.append('qr', image, image.name);

    return this.api
      .upload<PaymentChannelDetailsDto>(
        `/superadmin/payment-channels/${toPaymentChannelDto(channel)}/qr`,
        form,
      )
      .pipe(map(toPaymentChannelDetails));
  }

  /* ------------------------------ platform ------------------------------ */

  listForReview(
    status: PaymentStatusFilter,
    page: number,
    pageSize: number,
    search = '',
  ): Observable<PagedResult<PaymentRequest>> {
    return this.api
      .get<PagedResult<PaymentRequestDto>>(PLATFORM_BASE, {
        status: toStatusFilterDto(status),
        page,
        pageSize,
        search,
      })
      .pipe(map(toPagedDomain));
  }

  getForReview(id: string): Observable<PaymentRequest> {
    return this.api.get<PaymentRequestDto>(`${PLATFORM_BASE}/${id}`).pipe(map(toPaymentRequest));
  }

  /** Grants the plan. Super Admin only, and the only route that changes it. */
  approve(id: string): Observable<PaymentRequest> {
    return this.api
      .post<PaymentRequestDto>(`${PLATFORM_BASE}/${id}/approve`)
      .pipe(map(toPaymentRequest));
  }

  /** The reason is required: it is what the customer is told and acts on. */
  reject(id: string, reason: string): Observable<PaymentRequest> {
    return this.api
      .post<PaymentRequestDto, RejectPaymentRequestDto>(`${PLATFORM_BASE}/${id}/reject`, { reason })
      .pipe(map(toPaymentRequest));
  }

  /* ------------------------------ files ------------------------------ */

  /**
   * The proof image. Fetched as a blob because the endpoint needs the bearer
   * token, which a plain `<img src>` cannot carry; callers turn it into an
   * object URL and must revoke it when done.
   */
  downloadProof(url: string): Observable<Blob> {
    return this.api.downloadAbsolute(url);
  }
}
