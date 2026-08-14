import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import type { PaymentRequest } from '@core/models/payment-request.model';
import { paymentChannelLabel } from '@core/models/payment-request.model';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { SecureImageComponent } from '@shared/ui/secure-image/secure-image.component';

const MIN_REASON_LENGTH = 10;

export interface RejectionEvent {
  readonly request: PaymentRequest;
  readonly reason: string;
}

/**
 * Review one payment: the receipt, the amount claimed, and a decision.
 *
 * Approving grants the plan, so the two actions are deliberately asymmetric —
 * approve is one click, while rejecting opens a reason field that must be
 * filled in. The reason is emailed to the customer verbatim, which is why it
 * has a minimum length: "no" on its own leaves them with nothing to act on.
 */
@Component({
  selector: 'app-payment-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    TimeAgoPipe,
    ModalComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SecureImageComponent,
  ],
  templateUrl: './payment-review.component.html',
})
export class PaymentReviewComponent {
  readonly request = input.required<PaymentRequest>();
  readonly deciding = input(false);

  readonly approved = output<PaymentRequest>();
  readonly rejected = output<RejectionEvent>();
  readonly closed = output<void>();

  protected readonly rejecting = signal(false);
  protected readonly reason = signal('');
  protected readonly minLength = MIN_REASON_LENGTH;

  protected readonly isPending = computed(() => this.request().status === 'pending');

  protected readonly reasonTooShort = computed(
    () => this.reason().trim().length < MIN_REASON_LENGTH,
  );

  protected readonly channel = computed(() => paymentChannelLabel(this.request().channel));

  protected startRejecting(): void {
    this.rejecting.set(true);
  }

  protected cancelRejecting(): void {
    this.rejecting.set(false);
    this.reason.set('');
  }

  protected confirmApprove(): void {
    if (!this.deciding()) {
      this.approved.emit(this.request());
    }
  }

  protected confirmReject(): void {
    if (this.reasonTooShort() || this.deciding()) {
      return;
    }
    this.rejected.emit({ request: this.request(), reason: this.reason().trim() });
  }
}
