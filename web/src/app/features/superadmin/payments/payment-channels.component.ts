import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';

import type { ApiError, LoadState } from '@core/models/api.model';
import type { PaymentChannel, PaymentChannelDetails } from '@core/models/payment-request.model';
import {
  ACCEPTED_QR_ACCEPT_ATTR,
  MAX_QR_BYTES,
  describeProofSize,
  qrRejectionReason,
} from '@core/models/payment-request.model';
import { PaymentRequestService } from '@core/services/payment-request.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SecureImageComponent } from '@shared/ui/secure-image/secure-image.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/** A channel plus the edits in flight against it. */
interface ChannelDraft {
  readonly channel: PaymentChannel;
  displayName: string;
  accountTitle: string;
  accountNumber: string;
  bankName: string;
  instructions: string[];
  isActive: boolean;
  qrImageUrl: string;
}

function toDraft(details: PaymentChannelDetails): ChannelDraft {
  return {
    channel: details.channel,
    displayName: details.displayName,
    accountTitle: details.accountTitle,
    accountNumber: details.accountNumber,
    bankName: details.bankName,
    // Always leave one empty line so there is something to type into.
    instructions: [...details.instructions, ''],
    isActive: details.isActive,
    qrImageUrl: details.qrImageUrl,
  };
}

/**
 * Where the money actually goes.
 *
 * The channels ship inactive with placeholder account numbers, so until this
 * screen is filled in the checkout has nothing to offer. A channel cannot be
 * activated without an account title and number — an active channel with a
 * wrong number is worse than an absent one, because the customer's money
 * leaves and never arrives.
 */
@Component({
  selector: 'app-payment-channels',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardComponent,
    ButtonDirective,
    IconComponent,
    SecureImageComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './payment-channels.component.html',
})
export class PaymentChannelsComponent {
  private readonly payments = inject(PaymentRequestService);
  private readonly toast = inject(ToastService);

  private readonly qrInputs = viewChildren<ElementRef<HTMLInputElement>>('qrInput');

  protected readonly acceptAttr = ACCEPTED_QR_ACCEPT_ATTR;
  protected readonly maxQrLabel = describeProofSize(MAX_QR_BYTES);
  protected readonly skeletons = [1, 2, 3];

  protected readonly state = signal<LoadState>('loading');
  protected readonly drafts = signal<readonly ChannelDraft[]>([]);
  protected readonly savingChannel = signal<PaymentChannel | null>(null);
  protected readonly uploadingChannel = signal<PaymentChannel | null>(null);

  protected readonly activeCount = computed(
    () => this.drafts().filter((draft) => draft.isActive).length,
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');

    this.payments.listAllChannels().subscribe({
      next: (channels) => {
        this.drafts.set(channels.map(toDraft));
        this.state.set(channels.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  /* ------------------------------ editing ------------------------------ */

  protected update(channel: PaymentChannel, patch: Partial<ChannelDraft>): void {
    this.drafts.update((drafts) =>
      drafts.map((draft) => (draft.channel === channel ? { ...draft, ...patch } : draft)),
    );
  }

  protected setInstruction(channel: PaymentChannel, index: number, value: string): void {
    this.drafts.update((drafts) =>
      drafts.map((draft) => {
        if (draft.channel !== channel) {
          return draft;
        }
        const instructions = [...draft.instructions];
        instructions[index] = value;
        // Keep exactly one trailing blank so the list grows as it is filled.
        while (instructions.length > 0 && instructions[instructions.length - 1] === '') {
          instructions.pop();
        }
        return { ...draft, instructions: [...instructions, ''] };
      }),
    );
  }

  protected removeInstruction(channel: PaymentChannel, index: number): void {
    this.drafts.update((drafts) =>
      drafts.map((draft) =>
        draft.channel === channel
          ? { ...draft, instructions: draft.instructions.filter((_, i) => i !== index) }
          : draft,
      ),
    );
  }

  /** Activation is refused without somewhere for the money to land. */
  protected canActivate(draft: ChannelDraft): boolean {
    return draft.accountTitle.trim() !== '' && draft.accountNumber.trim() !== '';
  }

  protected toggleActive(draft: ChannelDraft): void {
    if (!draft.isActive && !this.canActivate(draft)) {
      this.toast.error(
        'Not ready to activate',
        'Add an account title and number first — customers would have nowhere to send money.',
      );
      return;
    }
    this.update(draft.channel, { isActive: !draft.isActive });
  }

  protected save(draft: ChannelDraft): void {
    if (this.savingChannel() !== null) {
      return;
    }
    if (draft.accountTitle.trim() === '' || draft.accountNumber.trim() === '') {
      this.toast.error('Missing details', 'An account title and number are required.');
      return;
    }
    this.savingChannel.set(draft.channel);

    this.payments
      .saveChannel(draft.channel, {
        displayName: draft.displayName.trim(),
        accountTitle: draft.accountTitle.trim(),
        accountNumber: draft.accountNumber.trim(),
        bankName: draft.bankName,
        instructions: draft.instructions,
        isActive: draft.isActive,
      })
      .subscribe({
        next: (updated) => {
          this.savingChannel.set(null);
          this.replace(updated);
          this.toast.success(`${updated.displayName} saved`, 'Customers see this immediately.');
        },
        error: (error: ApiError) => {
          this.savingChannel.set(null);
          this.toast.error(error.title, error.detail);
        },
      });
  }

  /* ------------------------------ QR ------------------------------ */

  protected browseQr(index: number): void {
    this.qrInputs()[index]?.nativeElement.click();
  }

  protected onQrInput(event: Event, channel: PaymentChannel): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;
    input.value = '';

    if (file === null) {
      return;
    }

    const reason = qrRejectionReason(file);
    if (reason !== null) {
      this.toast.error('That image cannot be used', reason);
      return;
    }

    this.uploadingChannel.set(channel);
    this.payments.uploadChannelQr(channel, file).subscribe({
      next: (updated) => {
        this.uploadingChannel.set(null);
        this.replace(updated);
        this.toast.success('QR code updated', `${updated.displayName} now shows the new code.`);
      },
      error: (error: ApiError) => {
        this.uploadingChannel.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  /** Replaces a draft wholesale, discarding unsaved edits for that channel only. */
  private replace(updated: PaymentChannelDetails): void {
    this.drafts.update((drafts) =>
      drafts.map((draft) => (draft.channel === updated.channel ? toDraft(updated) : draft)),
    );
  }
}
