import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import type { LoadState } from '@core/models/api.model';
import type {
  BillingHistory,
  Invoice,
  InvoiceStatus,
  Payment,
  PaymentStatus,
} from '@core/models/subscription.model';
import { EntitlementService } from '@core/services/entitlement.service';
import { SubscriptionService } from '@core/services/subscription.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

type BillingTab = 'invoices' | 'payments' | 'renewals';

const INVOICE_TONE: Readonly<Record<InvoiceStatus, BadgeTone>> = {
  paid: 'success',
  due: 'info',
  overdue: 'danger',
  refunded: 'neutral',
  void: 'neutral',
};

const PAYMENT_TONE: Readonly<Record<PaymentStatus, BadgeTone>> = {
  succeeded: 'success',
  failed: 'danger',
  pending: 'warning',
  refunded: 'neutral',
};

@Component({
  selector: 'app-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './billing.component.html',
})
export class BillingComponent {
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly entitlements = inject(EntitlementService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly history = signal<BillingHistory | null>(null);
  protected readonly tab = signal<BillingTab>('invoices');
  protected readonly skeletons = [1, 2, 3, 4, 5];

  protected readonly invoiceTone = INVOICE_TONE;
  protected readonly paymentTone = PAYMENT_TONE;
  protected readonly subscription = this.entitlements.subscription;

  protected readonly tabs: readonly { value: BillingTab; label: string }[] = [
    { value: 'invoices', label: 'Invoices' },
    { value: 'payments', label: 'Payments' },
    { value: 'renewals', label: 'Renewals' },
  ];

  protected readonly invoices = computed(() => this.history()?.invoices ?? []);
  protected readonly payments = computed(() => this.history()?.payments ?? []);
  protected readonly renewals = computed(() => this.history()?.renewals ?? []);

  protected readonly outstanding = computed(() =>
    this.invoices()
      .filter((invoice) => invoice.status === 'due' || invoice.status === 'overdue')
      .reduce((sum, invoice) => sum + invoice.amount + invoice.tax, 0),
  );

  protected readonly totalPaid = computed(() =>
    this.payments()
      .filter((payment) => payment.status === 'succeeded')
      .reduce((sum, payment) => sum + payment.amount, 0),
  );

  protected readonly hasFailedPayment = computed(() =>
    this.payments().some((payment) => payment.status === 'failed'),
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.subscriptionService.getBillingHistory().subscribe({
      next: (history) => {
        this.history.set(history);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected download(invoice: Invoice): void {
    this.toast.info(
      `Invoice ${invoice.number}`,
      'PDF generation is served by the billing provider once payments are wired up.',
    );
  }

  protected retry(payment: Payment): void {
    this.toast.info(
      'Retry queued',
      `We will attempt ${payment.invoiceNumber} again with the card on file.`,
    );
  }

  protected total(invoice: Invoice): number {
    return invoice.amount + invoice.tax;
  }
}
