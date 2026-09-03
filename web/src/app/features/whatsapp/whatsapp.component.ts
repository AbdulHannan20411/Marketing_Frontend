import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';

import { environment } from '@env/environment';
import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  ConnectionOnboarding,
  OnboardingStep,
  OnboardingStepState,
  QualityRating,
  WhatsAppConnection,
} from '@core/models/whatsapp.model';
import {
  IDLE_ONBOARDING,
  MESSAGING_TIER_LABELS,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_DETAIL,
  ONBOARDING_STEP_LABEL,
  ONBOARDING_STEP_SKIPPED,
  failedStep,
  onboardingRemedy,
} from '@core/models/whatsapp.model';
import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import {
  EmbeddedSignupError,
  MetaSignupService,
  describeMetaStep,
} from '@core/services/meta-signup.service';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { ConnectionExpiryNoticeComponent } from '@shared/ui/connection-expiry/connection-expiry-notice.component';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const QUALITY_TONE: Readonly<Record<QualityRating, BadgeTone>> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
};

/**
 * Onboarding runs on the server after the popup closes, so the only way to
 * follow it is to ask. Two seconds is frequent enough to feel live without
 * hammering an endpoint that talks to Meta.
 */
const POLL_INTERVAL_MS = 2000;

/**
 * When to stop waiting.
 *
 * Phone registration is the slow step and can genuinely take a minute. Three
 * minutes is well past any healthy run, so passing it means something is stuck
 * and the admin should be told rather than left watching a spinner forever.
 */
const POLL_TIMEOUT_MS = 180_000;

const QUALITY_LABEL: Readonly<Record<QualityRating, string>> = {
  green: 'High quality',
  yellow: 'Medium quality',
  red: 'Low quality',
};

@Component({
  selector: 'app-whatsapp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    ConnectionExpiryNoticeComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
    ModalComponent,
  ],
  templateUrl: './whatsapp.component.html',
})
export class WhatsAppComponent {
  private readonly whatsapp = inject(WhatsAppService);
  private readonly signup = inject(MetaSignupService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly scope = inject(AdminScopeService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly state = signal<LoadState>('loading');
  protected readonly connection = signal<WhatsAppConnection | null>(null);
  protected readonly syncing = signal(false);
  protected readonly connecting = signal(false);
  protected readonly disconnecting = signal(false);
  protected readonly busy = signal(false);

  protected readonly qualityTone = QUALITY_TONE;
  protected readonly qualityLabel = QUALITY_LABEL;
  protected readonly tierLabels = MESSAGING_TIER_LABELS;
  protected readonly signupConfigured = this.signup.isConfigured;

  protected readonly isConnected = computed(() => this.connection()?.status === 'connected');

  /* --------------------------- signup progress --------------------------- */

  private readonly destroyRef = inject(DestroyRef);
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private pollDeadline = 0;

  protected readonly steps = ONBOARDING_STEPS;
  protected readonly stepLabel = ONBOARDING_STEP_LABEL;
  protected readonly stepDetail = ONBOARDING_STEP_DETAIL;
  protected readonly skippedLabel = ONBOARDING_STEP_SKIPPED;

  /** Set when the popup itself failed, before the server was ever called. */
  protected readonly popupError = signal<string | null>(null);

  /**
   * Which events Meta actually sent.
   *
   * Kept beside the message rather than only in the console: a popup that ends
   * without an account is otherwise undiagnosable, and "Meta sent no signup
   * events" is the single most useful sentence for working out why.
   */
  protected readonly popupDiagnostic = signal<string | null>(null);

  /** Whether the operator detail behind the failure is expanded. */
  protected readonly detailOpen = signal(false);

  /**
   * The API always sends this. The fallback covers a server that predates it,
   * so a stale deployment shows an idle panel rather than crashing.
   */
  protected readonly onboarding = computed<ConnectionOnboarding>(
    () => this.connection()?.onboarding ?? IDLE_ONBOARDING,
  );

  /**
   * True from the moment the popup opens until the server says it has stopped.
   *
   * `running` comes from the connection's own status. Deriving it from the step
   * array instead would eventually disagree with the server about when to stop
   * polling — which is the one thing a poller must not do.
   */
  protected readonly inProgress = computed(() => this.connecting() || this.onboarding().running);

  protected readonly failure = computed(() => failedStep(this.onboarding()));
  protected readonly hasFailure = computed(() => this.failure() !== null);

  // Flattened for the template: `as` is not allowed on an `@else if`.
  protected readonly failureStepLabel = computed(() => {
    const failure = this.failure();
    return failure === null ? '' : ONBOARDING_STEP_LABEL[failure.step];
  });

  /**
   * The remedy, chosen by code.
   *
   * Goes through `onboardingRemedy` rather than indexing directly, because the
   * server adds codes over time and a build that has never heard of one must
   * still say something useful.
   */
  protected readonly failureRemedy = computed(() => onboardingRemedy(this.failure()?.code ?? null));

  /** Meta's own wording. Hidden behind a toggle — it is not end-user copy. */
  protected readonly failureMessage = computed(() => this.failure()?.message ?? null);

  private stateOf(step: OnboardingStep): OnboardingStepState | null {
    return this.onboarding().steps.find((entry) => entry.step === step) ?? null;
  }

  protected stepStatus(step: OnboardingStep): OnboardingStepState['status'] {
    return this.stateOf(step)?.status ?? 'pending';
  }

  /**
   * What to write under a step.
   *
   * A skipped step gets a plain statement of fact — "Already registered" — not
   * a warning: every number that came through signup is already registered,
   * and dressing that up as a problem is the false alarm this panel exists to
   * prevent. A running step gets its rationale; everything else gets nothing.
   */
  protected stepNote(step: OnboardingStep): string | null {
    const status = this.stepStatus(step);
    if (status === 'skipped') {
      return ONBOARDING_STEP_SKIPPED[step];
    }
    return status === 'running' ? ONBOARDING_STEP_DETAIL[step] : null;
  }

  /** Meta bills for conversations directly; we never see or mark up that spend. */
  protected readonly metaBillingUrl = 'https://business.facebook.com/billing_hub/accounts';
  protected readonly appName = environment.appName;

  /** Share of the rolling 24-hour Meta send ceiling already consumed. */
  protected readonly limitUsedPercent = computed(() => {
    const connection = this.connection();
    if (connection === null || connection.messagingLimit === 0) {
      return 0;
    }
    return Math.min(100, Math.round((connection.messagesLast24h / connection.messagingLimit) * 100));
  });

  constructor() {
    this.load();
  }

  /* ------------------------- manual connect (staff) ------------------------- */

  /**
   * A testing tool, not an onboarding route.
   *
   * A Meta **test number** is already claimed inside the developer app, so
   * there is no Embedded Signup flow to run against it — and `configId` needs
   * an app that has been through review. This is how the messaging path gets
   * exercised before then.
   *
   * Super Admin only, matching the API, which refuses anyone else. The token is
   * held in the form for the length of the request and never stored, logged or
   * echoed back.
   */
  protected readonly canConnectManually = computed(() => this.auth.isSuperAdmin());

  /** The workspace the connection lands in, chosen in the scope bar. */
  protected readonly scopedAdmin = this.scope.selected;
  protected readonly hasScope = this.scope.isScoped;

  protected readonly manualOpen = signal(false);
  protected readonly connectingManually = signal(false);

  protected readonly manualForm = this.formBuilder.nonNullable.group({
    accessToken: ['', Validators.required],
    wabaId: ['', Validators.required],
    phoneNumberId: ['', Validators.required],
  });

  protected openManual(): void {
    this.manualForm.reset({ accessToken: '', wabaId: '', phoneNumberId: '' });
    this.manualOpen.set(true);
  }

  protected closeManual(): void {
    // Cleared on the way out so a pasted token does not sit in memory behind a
    // closed dialog for the rest of the session.
    this.manualForm.reset({ accessToken: '', wabaId: '', phoneNumberId: '' });
    this.manualOpen.set(false);
  }

  protected submitManual(): void {
    if (this.manualForm.invalid || this.connectingManually()) {
      return;
    }

    const raw = this.manualForm.getRawValue();
    this.connectingManually.set(true);

    this.whatsapp
      .connectManually({
        accessToken: raw.accessToken.trim(),
        wabaId: raw.wabaId.trim(),
        phoneNumberId: raw.phoneNumberId.trim(),
      })
      .subscribe({
        next: (connection) => {
          this.connectingManually.set(false);
          this.connection.set(connection);
          this.state.set('ready');
          this.closeManual();
          this.toast.success(
            'WhatsApp connected',
            `${connection.displayPhoneNumber ?? 'The number'} is ready to send.`,
          );
        },
        error: (error: ApiError) => {
          this.connectingManually.set(false);
          this.toast.error(error.title, error.detail);
        },
      });
  }

  protected load(): void {
    this.state.set('loading');
    this.whatsapp.getConnection().subscribe({
      next: (connection) => {
        this.connection.set(connection);
        this.state.set('ready');

        // Onboarding outlives the tab: it runs on the server, so an admin who
        // reloads — or comes back later — must see it continue rather than a
        // progress panel frozen on whichever step it was on when they left.
        if (connection.status === 'pending') {
          this.startPolling();
        }
      },
      error: () => this.state.set('error'),
    });
  }

  protected sync(): void {
    this.syncing.set(true);
    this.whatsapp.syncConnection().subscribe({
      next: (connection) => {
        this.connection.set(connection);
        this.syncing.set(false);
        this.toast.success('Connection refreshed', 'Profile and health pulled from Meta.');
      },
      error: () => this.syncing.set(false),
    });
  }

  /* ------------------------------ Embedded Signup ------------------------------ */

  /**
   * Runs Meta's popup, then hands the result to the API.
   *
   * The authorisation code lives only as a local in this method — it goes
   * straight into the request and is never stored, because exchanging it needs
   * the app secret and that belongs on the server.
   */
  protected async connect(): Promise<void> {
    if (this.connecting()) {
      return;
    }

    if (!this.signup.isConfigured()) {
      this.toast.error(
        'WhatsApp signup is not configured',
        'The Meta app id and config id are missing from this environment.',
      );
      return;
    }

    this.connecting.set(true);
    this.popupError.set(null);
    this.popupDiagnostic.set(null);

    try {
      const result = await this.signup.launch();

      this.whatsapp.connect(result).subscribe({
        next: (connection) => {
          this.connecting.set(false);
          this.connection.set(connection);
          this.state.set('ready');

          // `pending` is the normal answer: the server accepted the code and is
          // now working through Meta. Anything terminal is handled in one place
          // so the poll and the immediate reply cannot disagree.
          if (connection.onboarding.running) {
            this.startPolling();
            return;
          }
          this.settle(connection);
        },
        error: (error: ApiError) => {
          this.connecting.set(false);
          this.toast.error(error.title, error.detail);
        },
      });
    } catch (error) {
      this.connecting.set(false);
      this.reportSignupFailure(error);
    }
  }

  /* ------------------------------ polling ------------------------------ */

  /**
   * Follows the server-side half.
   *
   * `setTimeout` chained per response rather than an interval: a slow reply
   * must not stack a second request behind the first, and the chain stops
   * dead the moment the state is terminal.
   */
  private startPolling(): void {
    this.stopPolling();
    this.pollDeadline = Date.now() + POLL_TIMEOUT_MS;
    this.destroyRef.onDestroy(() => this.stopPolling());
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.pollHandle = setTimeout(() => {
      this.whatsapp.getConnection().subscribe({
        next: (connection) => {
          this.connection.set(connection);

          if (connection.onboarding.running) {
            if (Date.now() >= this.pollDeadline) {
              this.stopPolling();
              this.toast.error(
                'Still working',
                'Meta has not finished after three minutes. Refresh to check again.',
              );
              return;
            }
            this.schedulePoll();
            return;
          }

          this.stopPolling();
          this.settle(connection);
        },
        // A dropped request mid-onboarding is not a failed onboarding. Keep
        // asking until the deadline rather than reporting a false failure.
        error: () => {
          if (Date.now() >= this.pollDeadline) {
            this.stopPolling();
            this.state.set('error');
            return;
          }
          this.schedulePoll();
        },
      });
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /** The one place a terminal onboarding state is announced. */
  private settle(connection: WhatsAppConnection): void {
    if (connection.status === 'connected') {
      this.toast.success(
        'WhatsApp connected',
        `${connection.verifiedName || connection.displayPhoneNumber} is ready to send.`,
      );
      return;
    }

    // The panel already carries the step, the remedy and the operator detail,
    // so the toast stays short rather than repeating a paragraph.
    const failure = failedStep(connection.onboarding);
    this.toast.error(
      'Could not finish connecting',
      failure === null
        ? 'Signup did not complete.'
        : `Stopped at ${ONBOARDING_STEP_LABEL[failure.step].toLowerCase()}.`,
    );
  }

  /**
   * Runs signup again.
   *
   * The popup has to reopen rather than the request being resent: the
   * authorisation code is single use, so a retry needs a fresh one. Safe to do
   * — the server never re-runs a step that already succeeded, so a failure at
   * `subscribe` does not re-register the number.
   */
  protected retryConnect(): void {
    this.popupError.set(null);
    this.popupDiagnostic.set(null);
    this.detailOpen.set(false);
    this.connection.update((current) =>
      current === null
        ? current
        : { ...current, status: 'disconnected', onboarding: IDLE_ONBOARDING },
    );
    void this.connect();
  }

  protected toggleDetail(): void {
    this.detailOpen.update((open) => !open);
  }

  /** Closing the popup is a decision, not a fault — it passes without a toast. */
  private reportSignupFailure(error: unknown): void {
    if (!(error instanceof EmbeddedSignupError)) {
      this.toast.error('Could not connect', 'Signup did not complete. Please try again.');
      return;
    }

    this.popupDiagnostic.set(error.diagnostic);

    switch (error.reason) {
      case 'cancelled': {
        // Closing the popup is a decision, not a fault — no toast. But when
        // Meta said *where* it was closed, that is worth leaving on the page:
        // "closed at verifying the phone number" is a support conversation.
        const where = describeMetaStep(error.metaStep);
        if (where !== null) {
          this.popupError.set(`Signup was closed at ${where}. Nothing was changed.`);
        }
        return;
      }
      case 'blocked':
        this.toast.error(
          'Signup could not open',
          "Meta's script was blocked. Disable your ad blocker for this site and try again.",
        );
        return;
      case 'unconfigured':
        this.toast.error('WhatsApp signup is not configured', error.message);
        return;
      default:
        // The panel carries the full sentence; the toast is a pointer to it,
        // because these messages are a paragraph and a toast is not.
        this.popupError.set(error.message);
        this.toast.error('Could not connect', 'See the reason above the Connect button.');
    }
  }

  protected confirmDisconnect(): void {
    this.disconnecting.set(true);
  }

  protected cancelDisconnect(): void {
    this.disconnecting.set(false);
  }

  protected disconnect(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);

    this.whatsapp.disconnect().subscribe({
      next: (connection) => {
        this.busy.set(false);
        this.disconnecting.set(false);
        this.connection.set(connection);
        this.toast.success(
          'WhatsApp disconnected',
          'Campaigns cannot send until an account is connected again.',
        );
      },
      error: (error: ApiError) => {
        this.busy.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
