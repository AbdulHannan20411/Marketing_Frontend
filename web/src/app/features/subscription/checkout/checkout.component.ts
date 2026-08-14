import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  PaymentChannel,
  PaymentChannelDetails,
  PaymentRequest,
} from '@core/models/payment-request.model';
import {
  ACCEPTED_PROOF_ACCEPT_ATTR,
  MAX_PROOF_BYTES,
  describeProofSize,
  paymentChannelLabel,
  proofRejectionReason,
} from '@core/models/payment-request.model';
import type { BillingCycle, SubscriptionPlan } from '@core/models/subscription.model';
import { PaymentRequestService } from '@core/services/payment-request.service';
import { SubscriptionService } from '@core/services/subscription.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SecureImageComponent } from '@shared/ui/secure-image/secure-image.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/** Where the customer is in the flow. Nothing is sent before `proof`. */
type CheckoutStep = 'method' | 'pay' | 'proof' | 'submitted';

const STEPS: readonly { key: CheckoutStep; label: string }[] = [
  { key: 'method', label: 'Payment method' },
  { key: 'pay', label: 'Send payment' },
  { key: 'proof', label: 'Upload proof' },
];

const CHANNEL_ICON: Readonly<Record<PaymentChannel, 'creditCard' | 'building' | 'chat'>> = {
  jazzCash: 'creditCard',
  easyPaisa: 'creditCard',
  bankTransfer: 'building',
};

/**
 * Manual checkout.
 *
 * Payment happens outside this app: the customer transfers the money, uploads
 * a screenshot, and a platform administrator decides. Nothing here grants the
 * plan — submitting only queues a request — so the final screen is deliberately
 * "awaiting approval" rather than a success page, and the plan on the account
 * is unchanged until someone approves it.
 */
@Component({
  selector: 'app-checkout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
    PageHeaderComponent,
    CardComponent,
    ButtonDirective,
    IconComponent,
    SecureImageComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './checkout.component.html',
})
export class CheckoutComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly payments = inject(PaymentRequestService);
  private readonly subscriptions = inject(SubscriptionService);
  private readonly toast = inject(ToastService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('proofInput');
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly steps = STEPS;
  protected readonly channelIcon = CHANNEL_ICON;
  protected readonly acceptAttr = ACCEPTED_PROOF_ACCEPT_ATTR;
  protected readonly maxProofLabel = describeProofSize(MAX_PROOF_BYTES);
  protected readonly breadcrumbs = [
    { label: 'Plans & pricing', route: '/pricing' },
    { label: 'Checkout', route: null },
  ];

  protected readonly state = signal<LoadState>('loading');
  protected readonly step = signal<CheckoutStep>('method');
  protected readonly plan = signal<SubscriptionPlan | null>(null);
  protected readonly channels = signal<readonly PaymentChannelDetails[]>([]);
  protected readonly selected = signal<PaymentChannelDetails | null>(null);

  protected readonly proofFile = signal<File | null>(null);
  protected readonly proofPreview = signal<string | null>(null);
  protected readonly proofError = signal<string | null>(null);
  protected readonly reference = signal('');
  protected readonly note = signal('');

  protected readonly submitting = signal(false);
  protected readonly submitted = signal<PaymentRequest | null>(null);
  /** True when the final screen is showing a request that already existed. */
  protected readonly alreadyOpen = signal(false);
  protected readonly withdrawing = signal(false);
  protected readonly copied = signal<string | null>(null);

  protected readonly planId = computed(() => this.params()?.get('planId') ?? '');
  protected readonly cycle = computed<BillingCycle>(() =>
    this.params()?.get('cycle') === 'yearly' ? 'yearly' : 'monthly',
  );

  protected readonly amount = computed(() => {
    const plan = this.plan();
    if (plan === null) {
      return 0;
    }
    return this.cycle() === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
  });

  protected readonly activeChannels = computed(() =>
    this.channels().filter((channel) => channel.isActive),
  );

  protected readonly canSubmit = computed(() => this.proofFile() !== null && !this.submitting());

  protected readonly stepIndex = computed(() => {
    const current = this.step();
    const index = STEPS.findIndex((entry) => entry.key === current);
    return index === -1 ? STEPS.length : index;
  });

  constructor() {
    // The plan comes from the query string, so a changed link reloads the page.
    effect(() => {
      const id = this.planId();
      untracked(() => this.load(id));
    });
  }

  private load(planId: string): void {
    if (planId === '') {
      this.state.set('error');
      return;
    }
    this.state.set('loading');

    this.subscriptions.listPlans().subscribe({
      next: (plans) => {
        const plan = plans.find((entry) => entry.id === planId) ?? null;
        this.plan.set(plan);
        if (plan === null) {
          this.state.set('error');
          return;
        }
        this.loadChannels();
      },
      error: () => this.state.set('error'),
    });
  }

  private loadChannels(): void {
    this.payments.listChannels().subscribe({
      next: (channels) => {
        this.channels.set(channels);
        this.state.set(channels.some((channel) => channel.isActive) ? 'ready' : 'empty');
      },
      error: () => this.state.set('error'),
    });
  }

  protected retry(): void {
    this.load(this.planId());
  }

  protected label(channel: PaymentChannel): string {
    return paymentChannelLabel(channel);
  }

  /* ------------------------------ steps ------------------------------ */

  protected choose(channel: PaymentChannelDetails): void {
    this.selected.set(channel);
    this.step.set('pay');
  }

  protected backToMethod(): void {
    this.step.set('method');
  }

  /** "I've paid" — moves to proof. It asserts nothing; the screenshot does. */
  protected confirmPaid(): void {
    this.step.set('proof');
  }

  protected backToPay(): void {
    this.step.set('pay');
  }

  /* ------------------------------ proof ------------------------------ */

  protected browse(): void {
    this.fileInput().nativeElement.click();
  }

  protected onProofInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.offer(input.files?.item(0) ?? null);
    input.value = '';
  }

  protected onProofDrop(event: DragEvent): void {
    event.preventDefault();
    this.offer(event.dataTransfer?.files.item(0) ?? null);
  }

  protected allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  private offer(file: File | null): void {
    if (file === null) {
      return;
    }

    const reason = proofRejectionReason(file);
    if (reason !== null) {
      this.proofError.set(reason);
      return;
    }

    this.proofError.set(null);
    this.clearPreview();
    this.proofFile.set(file);

    // A PDF has no inline preview; the file name is the only confirmation.
    if (file.type.startsWith('image/')) {
      this.proofPreview.set(URL.createObjectURL(file));
    }
  }

  protected clearProof(): void {
    this.clearPreview();
    this.proofFile.set(null);
    this.proofError.set(null);
  }

  private clearPreview(): void {
    const current = this.proofPreview();
    if (current !== null) {
      URL.revokeObjectURL(current);
      this.proofPreview.set(null);
    }
  }

  protected describe(bytes: number): string {
    return describeProofSize(bytes);
  }

  /* ------------------------------ submit ------------------------------ */

  protected submit(): void {
    const plan = this.plan();
    const channel = this.selected();
    const proof = this.proofFile();

    if (plan === null || channel === null || proof === null || this.submitting()) {
      return;
    }
    this.submitting.set(true);

    this.payments
      .submit(
        {
          planId: plan.id,
          billingCycle: this.cycle(),
          channel: channel.channel,
          reference: this.reference().trim(),
          note: this.note().trim(),
        },
        proof,
      )
      .subscribe({
        next: (request) => {
          this.submitting.set(false);
          this.submitted.set(request);
          this.step.set('submitted');
          this.clearPreview();
          this.toast.success(
            'Payment submitted',
            'We have sent it for review. You will be notified once it is approved.',
          );
        },
        error: (error: ApiError) => {
          this.submitting.set(false);

          // Only one request may be open at a time. That is not a failure the
          // customer can act on from here — they have already paid — so show
          // the one they have rather than an error they will read as "lost".
          if (error.errorCode === 'payment_request_pending') {
            this.showExistingRequest();
            return;
          }

          this.proofError.set(error.fieldErrors['proof']?.[0] ?? null);
          this.toast.error(error.title, error.detail);
        },
      });
  }

  /** Falls back to the toast if the existing request cannot be fetched. */
  private showExistingRequest(): void {
    this.payments.latestMine().subscribe({
      next: (request) => {
        // Only a *pending* one explains the refusal. Showing a decided request
        // here would tell the customer their payment is under review when it
        // is not — worse than the generic message.
        if (request === null || request.status !== 'pending') {
          this.toast.error(
            'Already submitted',
            'A payment is already awaiting review. Check your subscription page.',
          );
          return;
        }
        this.submitted.set(request);
        this.alreadyOpen.set(true);
        this.step.set('submitted');
        this.clearPreview();
      },
      error: () =>
        this.toast.error(
          'Already submitted',
          'A payment is already awaiting review. Check your subscription page.',
        ),
    });
  }

  /** Account numbers are long and mistyping one sends money nowhere. */
  protected copy(value: string): void {
    void navigator.clipboard.writeText(value).then(
      () => {
        this.copied.set(value);
        setTimeout(() => this.copied.set(null), 2000);
      },
      () => this.toast.error('Could not copy', 'Copy the number manually.'),
    );
  }

  /** Withdraws the open request so a corrected one can be submitted. */
  protected withdraw(): void {
    const request = this.submitted();
    if (request === null || this.withdrawing()) {
      return;
    }
    this.withdrawing.set(true);

    this.payments.cancel(request.id).subscribe({
      next: () => {
        this.withdrawing.set(false);
        this.submitted.set(null);
        this.alreadyOpen.set(false);
        this.proofFile.set(null);
        this.step.set('method');
        this.toast.success('Payment withdrawn', 'You can submit a new one now.');
      },
      error: (error: ApiError) => {
        this.withdrawing.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected done(): void {
    void this.router.navigate(['/subscription']);
  }
}
