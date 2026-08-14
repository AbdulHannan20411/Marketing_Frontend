import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type { ApiError, LoadState } from '@core/models/api.model';
import type { PaymentRequest, PaymentRequestStatus } from '@core/models/payment-request.model';
import { PAYMENT_STATUS_LABELS, paymentChannelLabel } from '@core/models/payment-request.model';
import {
  PaymentRequestService,
  type PaymentStatusFilter,
} from '@core/services/payment-request.service';
import { RealtimeService } from '@core/services/realtime.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { DEFAULT_PAGE_SIZE, PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { PaymentChannelsComponent } from './payment-channels.component';
import { PaymentReviewComponent } from './payment-review.component';

const STATUS_TONE: Readonly<Record<PaymentRequestStatus, BadgeTone>> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const FILTERS: readonly { value: PaymentStatusFilter; label: string }[] = [
  { value: 'pending', label: 'Awaiting review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

/**
 * The manual-payment queue.
 *
 * This is the only place a plan is granted from a payment, so the decision is
 * deliberately slow: the reviewer sees the amount, the plan and the uploaded
 * receipt together, and a rejection cannot be recorded without a reason the
 * customer will read.
 */
@Component({
  selector: 'app-superadmin-payments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    PaginationComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    PaymentReviewComponent,
    PaymentChannelsComponent,
  ],
  templateUrl: './payments.component.html',
})
export class SuperAdminPaymentsComponent {
  private readonly payments = inject(PaymentRequestService);
  private readonly realtime = inject(RealtimeService);
  private readonly toast = inject(ToastService);

  protected readonly filters = FILTERS;
  protected readonly statusTone = STATUS_TONE;
  protected readonly statusLabels = PAYMENT_STATUS_LABELS;
  protected readonly skeletons = [1, 2, 3, 4, 5];
  protected readonly breadcrumbs = [
    { label: 'Platform', route: null },
    { label: 'Payments', route: null },
  ];

  /** The queue, or the account details customers pay into. */
  protected readonly view = signal<'requests' | 'channels'>('requests');

  protected readonly state = signal<LoadState>('loading');
  protected readonly requests = signal<readonly PaymentRequest[]>([]);
  protected readonly filter = signal<PaymentStatusFilter>('pending');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  protected readonly totalItems = signal(0);

  /** The request open in the review panel, if any. */
  protected readonly reviewing = signal<PaymentRequest | null>(null);
  protected readonly deciding = signal(false);

  protected readonly pendingCount = computed(
    () => this.requests().filter((request) => request.status === 'pending').length,
  );

  constructor() {
    this.load();

    // A submission or a decision elsewhere should surface here without a reload.
    this.realtime.paymentRequests$.pipe(takeUntilDestroyed()).subscribe(() => this.load(true));
  }

  protected load(silent = false): void {
    if (!silent) {
      this.state.set('loading');
    }

    this.payments
      .listForReview(this.filter(), this.page(), this.pageSize(), this.search().trim())
      .subscribe({
        next: (result) => {
          this.requests.set(result.items);
          this.totalItems.set(result.totalItems);
          this.state.set(result.totalItems === 0 ? 'empty' : 'ready');
        },
        error: () => {
          // A failed background refresh must not replace a working table.
          if (!silent) {
            this.state.set('error');
          }
        },
      });
  }

  protected setFilter(value: PaymentStatusFilter): void {
    this.filter.set(value);
    this.page.set(1);
    this.load();
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    this.page.set(1);
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    this.load();
  }

  protected open(request: PaymentRequest): void {
    this.reviewing.set(request);
  }

  protected closeReview(): void {
    this.reviewing.set(null);
  }

  protected channelLabel(request: PaymentRequest): string {
    return paymentChannelLabel(request.channel);
  }

  /* ------------------------------ decisions ------------------------------ */

  protected approve(request: PaymentRequest): void {
    if (this.deciding()) {
      return;
    }
    this.deciding.set(true);

    this.payments.approve(request.id).subscribe({
      next: (updated) => {
        this.deciding.set(false);
        this.reviewing.set(null);
        this.toast.success(
          'Payment approved',
          `${updated.organisation} is now on ${updated.planName}.`,
        );
        this.load(true);
      },
      error: (error: ApiError) => this.onDecisionError(error),
    });
  }

  protected reject(event: { request: PaymentRequest; reason: string }): void {
    if (this.deciding()) {
      return;
    }
    this.deciding.set(true);

    this.payments.reject(event.request.id, event.reason).subscribe({
      next: (updated) => {
        this.deciding.set(false);
        this.reviewing.set(null);
        this.toast.success(
          'Payment rejected',
          `${updated.organisation} has been told why and can submit again.`,
        );
        this.load(true);
      },
      error: (error: ApiError) => this.onDecisionError(error),
    });
  }

  /**
   * Two reviewers working the same queue is expected, not exceptional. The
   * server decides once; a loser here is shown what actually happened rather
   * than an error implying their click broke something.
   */
  private onDecisionError(error: ApiError): void {
    this.deciding.set(false);

    if (error.errorCode === 'payment_already_decided') {
      this.toast.info('Already decided', 'Another reviewer got there first.');
      this.reviewing.set(null);
      this.load(true);
      return;
    }

    this.toast.error(error.title, error.detail);
  }
}
