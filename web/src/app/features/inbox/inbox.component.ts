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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { interval } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  Conversation,
  ConversationMessage,
  MediaAsset,
  MediaKind,
} from '@core/models/whatsapp.model';
import {
  AUDIO_RULE,
  MEDIA_RULES,
  formatWindowRemaining,
  isWindowOpen,
  mediaRejectionReason,
  windowRemainingMs,
} from '@core/models/whatsapp.model';
import { RealtimeService } from '@core/services/realtime.service';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SecureImageComponent } from '@shared/ui/secure-image/secure-image.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/** What the paperclip offers. Audio is reply-only, never a campaign. */
type AttachmentKind = MediaKind | 'audio';

const PAGE_SIZE = 30;

/**
 * The 24-hour customer service window.
 *
 * Meta only permits free-form replies for 24 hours after the customer's last
 * message; outside that, an approved template is the only way to reach them.
 * The countdown is therefore not decoration — it is the difference between a
 * reply that sends and one Meta rejects, so it ticks live and the composer
 * closes with it.
 */
@Component({
  selector: 'app-inbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TimeAgoPipe,
    PageHeaderComponent,
    AvatarComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SecureImageComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './inbox.component.html',
})
export class InboxComponent {
  private readonly whatsapp = inject(WhatsAppService);
  private readonly realtime = inject(RealtimeService);
  private readonly toast = inject(ToastService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('attachmentInput');
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  protected readonly state = signal<LoadState>('loading');
  protected readonly conversations = signal<readonly Conversation[]>([]);
  protected readonly search = signal('');

  protected readonly selectedId = signal<string | null>(null);
  protected readonly messages = signal<readonly ConversationMessage[]>([]);
  protected readonly threadState = signal<LoadState>('idle');

  protected readonly draft = signal('');
  protected readonly attachment = signal<MediaAsset | null>(null);
  protected readonly attachmentKind = signal<AttachmentKind>('image');
  protected readonly uploading = signal(false);
  protected readonly sending = signal(false);

  /** Ticks every 30s so the countdown and the composer stay honest. */
  private readonly now = signal(Date.now());

  protected readonly mediaRules = MEDIA_RULES;
  protected readonly audioRule = AUDIO_RULE;
  protected readonly skeletons = [1, 2, 3, 4, 5];

  /** The API returns a display name only; the avatar wants initials. */
  protected initialsFor(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  protected readonly selected = computed(
    () => this.conversations().find((entry) => entry.id === this.selectedId()) ?? null,
  );

  protected readonly visibleConversations = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (term === '') {
      return this.conversations();
    }
    return this.conversations().filter(
      (entry) =>
        entry.contactName.toLowerCase().includes(term) || entry.phoneNumber.includes(term),
    );
  });

  protected readonly windowOpen = computed(() => {
    const conversation = this.selected();
    return conversation !== null && isWindowOpen(conversation, this.now());
  });

  protected readonly windowLabel = computed(() => {
    const conversation = this.selected();
    if (conversation === null) {
      return '';
    }
    return formatWindowRemaining(windowRemainingMs(conversation, this.now()));
  });

  /** Under an hour left is worth flagging: the reply may not make it. */
  protected readonly windowClosingSoon = computed(() => {
    const conversation = this.selected();
    if (conversation === null) {
      return false;
    }
    const remaining = windowRemainingMs(conversation, this.now());
    return remaining > 0 && remaining < 3_600_000;
  });

  protected readonly canSend = computed(
    () =>
      this.windowOpen() &&
      !this.sending() &&
      !this.uploading() &&
      (this.draft().trim() !== '' || this.attachment() !== null),
  );

  protected readonly acceptAttr = computed(() => {
    const kind = this.attachmentKind();
    return kind === 'audio' ? AUDIO_RULE.accept : MEDIA_RULES[kind].accept;
  });

  constructor() {
    this.load();

    interval(30_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.now.set(Date.now()));

    // An inbound message reopens the window, so the thread and the list both
    // need to react rather than waiting for a manual refresh.
    this.realtime.resynced$.pipe(takeUntilDestroyed()).subscribe(() => this.load(true));

    effect(() => {
      const id = this.selectedId();
      untracked(() => {
        if (id === null) {
          this.messages.set([]);
          this.threadState.set('idle');
          return;
        }
        this.loadThread(id);
      });
    });
  }

  protected load(silent = false): void {
    if (!silent) {
      this.state.set('loading');
    }

    this.whatsapp.listConversations(1, 50, this.search().trim()).subscribe({
      next: (result) => {
        this.conversations.set(result.items);
        this.state.set(result.totalItems === 0 ? 'empty' : 'ready');

        // Open the newest thread on first load so the pane is never blank.
        if (this.selectedId() === null && result.items.length > 0) {
          this.selectedId.set(result.items[0].id);
        }
      },
      error: () => {
        if (!silent) {
          this.state.set('error');
        }
      },
    });
  }

  protected select(conversation: Conversation): void {
    this.selectedId.set(conversation.id);
    this.draft.set('');
    this.attachment.set(null);

    if (conversation.unreadCount > 0) {
      this.whatsapp.markRead(conversation.id).subscribe({
        next: (updated) => this.replaceConversation(updated),
        error: () => {},
      });
    }
  }

  protected loadThread(conversationId: string): void {
    this.threadState.set('loading');

    this.whatsapp.listMessages(conversationId, 1, PAGE_SIZE).subscribe({
      next: (result) => {
        this.messages.set(result.items);
        this.threadState.set(result.totalItems === 0 ? 'empty' : 'ready');
        this.scrollToLatest();
      },
      error: () => this.threadState.set('error'),
    });
  }

  private replaceConversation(updated: Conversation): void {
    this.conversations.update((current) =>
      current.map((entry) => (entry.id === updated.id ? updated : entry)),
    );
  }

  /** Runs after render so the newest message is in view, not just loaded. */
  private scrollToLatest(): void {
    setTimeout(() => {
      const element = this.thread()?.nativeElement;
      if (element !== undefined) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  /* ------------------------------ attachments ------------------------------ */

  protected chooseAttachment(kind: AttachmentKind): void {
    this.attachmentKind.set(kind);
    // The accept attribute is bound, so let it settle before opening the picker.
    setTimeout(() => this.fileInput().nativeElement.click());
  }

  protected onAttachmentInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;
    input.value = '';

    if (file === null) {
      return;
    }

    const kind = this.attachmentKind();
    const reason = mediaRejectionReason(file, kind);
    if (reason !== null) {
      this.toast.error('That file cannot be sent', reason);
      return;
    }

    this.uploading.set(true);
    this.whatsapp.uploadMedia(file, kind).subscribe({
      next: (asset) => {
        this.uploading.set(false);
        this.attachment.set(asset);
      },
      error: (error: ApiError) => {
        this.uploading.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected clearAttachment(): void {
    this.attachment.set(null);
  }

  /* ------------------------------ sending ------------------------------ */

  protected send(): void {
    const conversation = this.selected();
    if (conversation === null || !this.canSend()) {
      return;
    }

    const asset = this.attachment();
    this.sending.set(true);

    this.whatsapp
      .sendMessage({
        conversationId: conversation.id,
        kind: asset === null ? 'text' : (asset.kind as 'image' | 'video' | 'document' | 'audio'),
        body: this.draft().trim(),
        mediaId: asset?.id ?? null,
      })
      .subscribe({
        next: (message) => {
          this.sending.set(false);
          this.draft.set('');
          this.attachment.set(null);
          this.messages.update((current) => [...current, message]);
          this.scrollToLatest();
        },
        error: (error: ApiError) => {
          this.sending.set(false);
          if (error.errorCode === 'window_closed') {
            // The clock moved while they were typing; reload so the UI agrees.
            this.now.set(Date.now());
            this.load(true);
            this.toast.error(
              'The window has closed',
              'This customer has not messaged in 24 hours. Send an approved template instead.',
            );
            return;
          }
          this.toast.error(error.title, error.detail);
        },
      });
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }
}
