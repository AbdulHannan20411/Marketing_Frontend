import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';

import { environment } from '@env/environment';
import type { ApiError, LoadState } from '@core/models/api.model';
import type { QualityRating, WhatsAppConnection } from '@core/models/whatsapp.model';
import { MESSAGING_TIER_LABELS } from '@core/models/whatsapp.model';
import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { EmbeddedSignupError, MetaSignupService } from '@core/services/meta-signup.service';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
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

    try {
      const result = await this.signup.launch();

      this.whatsapp.connect(result).subscribe({
        next: (connection) => {
          this.connecting.set(false);
          this.connection.set(connection);
          this.state.set('ready');
          this.toast.success(
            'WhatsApp connected',
            `${connection.verifiedName} is ready to send.`,
          );
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

  /** Closing the popup is a decision, not a fault — it passes without a toast. */
  private reportSignupFailure(error: unknown): void {
    if (!(error instanceof EmbeddedSignupError)) {
      this.toast.error('Could not connect', 'Signup did not complete. Please try again.');
      return;
    }

    switch (error.reason) {
      case 'cancelled':
        return;
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
        this.toast.error('Could not connect', error.message);
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
