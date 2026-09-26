import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  BillingHistory,
  Invoice,
  InvoiceStatus,
  Payment,
  PaymentStatus,
} from '@core/models/subscription.model';
import type { SubscriptionSnapshot } from '@core/models/subscription.model';
import { SubscriptionService } from '@core/services/subscription.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { clientSorter, type SortColumn } from '@shared/ui/data-table/sort';
import { SortHeaderComponent } from '@shared/ui/data-table/sort-header.component';
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

/** What an invoice row can be ordered by. */
const INVOICE_SORT_COLUMNS: readonly SortColumn<Invoice>[] = [
  { key: 'number', label: 'Invoice number', kind: 'text', value: (invoice) => invoice.number },
  { key: 'planName', label: 'Plan', kind: 'text', value: (invoice) => invoice.planName },
  { key: 'status', label: 'Status', kind: 'text', value: (invoice) => invoice.status },
  {
    key: 'amount',
    label: 'Amount',
    kind: 'number',
    // The total the row shows, tax included — not the pre-tax figure, which
    // is never on screen.
    value: (invoice) => invoice.amount + invoice.tax,
    initialDirection: 'desc',
  },
  {
    key: 'issuedAt',
    label: 'Issued',
    kind: 'date',
    value: (invoice) => invoice.issuedAt,
    initialDirection: 'desc',
  },
  {
    key: 'paidAt',
    label: 'Paid',
    kind: 'date',
    // Null for anything unpaid, which the comparator keeps at the end either
    // way round rather than filling the first page with blanks.
    value: (invoice) => invoice.paidAt,
    initialDirection: 'desc',
  },
];

@Component({
  selector: 'app-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SortHeaderComponent,
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
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly history = signal<BillingHistory | null>(null);
  protected readonly tab = signal<BillingTab>('invoices');
  protected readonly paying = signal<string | null>(null);
  protected readonly skeletons = [1, 2, 3, 4, 5];

  protected readonly invoiceTone = INVOICE_TONE;
  protected readonly paymentTone = PAYMENT_TONE;
  /**
   * Billing detail comes from `GET /subscription`, not from entitlements.
   *
   * Entitlements are loaded for every signed-in user and carry no pricing by
   * design — an amount there would be readable by every employee. This screen
   * is already behind `settings.billing`, so it is the right place to ask.
   */
  private readonly billing = signal<SubscriptionSnapshot | null>(null);
  protected readonly subscription = computed(() => this.billing()?.subscription ?? null);

  protected readonly tabs: readonly { value: BillingTab; label: string }[] = [
    { value: 'invoices', label: 'Invoices' },
    { value: 'payments', label: 'Payments' },
    { value: 'renewals', label: 'Renewals' },
  ];

  private readonly allInvoices = computed(() => this.history()?.invoices ?? []);

  /**
   * Ordering in the browser.
   *
   * `GET /billing/history` answers with the whole history in one payload and
   * this table renders all of it, so sorting here orders everything rather
   * than a page.
   *
   * `Invoice` has `issuedAt`, `dueAt` and `paidAt` — dates that describe the
   * invoice itself. There is no created/modified audit pair on the contract,
   * and inventing one would be fiction.
   */
  protected readonly invoiceSorter = clientSorter(this.allInvoices, INVOICE_SORT_COLUMNS);

  protected readonly invoices = this.invoiceSorter.rows;
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
    this.loadBilling();
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

  /** The server-side renderer is not built yet and answers 501. */
  protected download(invoice: Invoice): void {
    this.subscriptionService.downloadInvoice(invoice.id, invoice.number).subscribe({
      next: () => this.toast.success('Invoice downloaded', invoice.number),
      error: (error: ApiError) => {
        this.toast.error(
          error.status === 501 ? 'Not available yet' : error.title,
          error.status === 501
            ? 'Invoice PDFs are not generated by the API yet.'
            : error.detail,
        );
      },
    });
  }

  protected retry(payment: Payment): void {
    const invoice = this.invoices().find((entry) => entry.number === payment.invoiceNumber);
    if (invoice === undefined || this.paying() !== null) {
      return;
    }
    this.paying.set(invoice.id);

    this.subscriptionService.payInvoice(invoice.id).subscribe({
      next: () => {
        this.paying.set(null);
        this.toast.success('Payment taken', `${payment.invoiceNumber} has been settled.`);
        this.load();
      },
      error: (error: ApiError) => {
        this.paying.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected total(invoice: Invoice): number {
    return invoice.amount + invoice.tax;
  }

  /** Silent on failure: the invoice table below is the point of this page. */
  private loadBilling(): void {
    this.subscriptionService.getSnapshot().subscribe({
      next: (snapshot) => this.billing.set(snapshot),
      error: () => this.billing.set(null),
    });
  }
}
