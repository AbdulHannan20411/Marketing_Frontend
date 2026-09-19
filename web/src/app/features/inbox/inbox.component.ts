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
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, interval, skip } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  Conversation,
  ConversationAssigneeFilter,
  ConversationFilters,
  ConversationMessage,
  ConversationStatusFilter,
  ConversationTypeFilter,
  InboundMessageEvent,
  MediaAsset,
  MediaKind,
} from '@core/models/whatsapp.model';
import {
  AUDIO_RULE,
  DEFAULT_CONVERSATION_FILTERS,
  MEDIA_RULES,
  formatWindowRemaining,
  isWindowOpen,
  mediaRejectionReason,
  windowRemainingMs,
} from '@core/models/whatsapp.model';
import { RealtimeService } from '@core/services/realtime.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/auth/auth.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { WhatsAppContextService } from '@core/services/whatsapp-context.service';
import { employeeIdOf, isSamePerson } from '@core/models/employee.model';
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
/** Enough to fill the pane without a second request in the common case. */
const CONVERSATION_PAGE_SIZE = 30;

const STATUS_OPTIONS: readonly { value: ConversationStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'awaiting_reply', label: 'Waiting for reply' },
  { value: 'replied', label: 'Replied' },
];

const ASSIGNEE_OPTIONS: readonly { value: ConversationAssigneeFilter; label: string }[] = [
  { value: 'all', label: 'Anyone' },
  { value: 'me', label: 'Me' },
  { value: 'unassigned', label: 'Unassigned' },
];

const TYPE_OPTIONS: readonly { value: ConversationTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'text', label: 'Text' },
  { value: 'media', label: 'Media' },
  { value: 'template', label: 'Template' },
];

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
  /**
   * The API does not serve conversations at all, rather than having failed once.
   *
   * A 404 here is not a transient fault: offering "try again" for an endpoint
   * that does not exist sends the user round a loop that cannot end.
   */
  protected readonly unavailable = signal(false);
  /**
   * Whether this user may actually send.
   *
   * Reading a conversation and replying under the workspace's verified name are
   * separate permissions, and the API enforces both. Without this the composer
   * rendered for anyone who could open the Inbox: they would type a reply, send
   * it, and collect a 403 — the permission model working correctly and the UI
   * refusing to admit it.
   */
  protected readonly canReply = computed(
    () => this.auth.hasPermission('whatsapp.inbox.reply') && !this.replyBlockedByNumber(),
  );

  /**
   * The person may reply in general, but not on this conversation's number.
   *
   * Told apart from the missing global permission because the fix differs: one
   * is "ask for the Inbox reply permission", the other "ask to be given Reply
   * on Support".
   */
  protected readonly replyBlockedByNumber = computed(() => {
    const accountId = this.selected()?.accountId;
    if (accountId === undefined) {
      return false;
    }
    const account = this.context.accounts().find((entry) => entry.id === accountId);
    // Not in the list yet means it has not loaded; the server still decides.
    return account !== undefined && !account.myPermissions.includes('reply');
  });

  private readonly context = inject(WhatsAppContextService);

  /* ------------------------------ filters ------------------------------ */

  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly assigneeOptions = ASSIGNEE_OPTIONS;
  protected readonly typeOptions = TYPE_OPTIONS;

  protected readonly filters = signal<ConversationFilters>(DEFAULT_CONVERSATION_FILTERS);
  protected readonly numbers = computed(() => this.context.accounts());

  /** Which number a row came from only matters once there is more than one. */
  protected readonly showNumber = computed(() => this.context.hasMultiple());

  protected readonly hasActiveFilters = computed(() => {
    const filters = this.filters();
    return (
      this.search().trim() !== '' ||
      filters.accountId !== 'all' ||
      filters.status !== 'all' ||
      filters.assignedTo !== 'all' ||
      filters.messageType !== 'all'
    );
  });

  /** In the `emp_` form conversations use, so "assigned to me" can match. */
  protected readonly myUserId = computed(() => {
    const id = this.auth.user()?.id;
    return id === undefined ? null : employeeIdOf(id);
  });

  protected isMe(id: string | null | undefined): boolean {
    return isSamePerson(id, this.myUserId());
  }
  protected readonly assigning = signal(false);

  private readonly auth = inject(AuthService);

  protected readonly conversations = signal<readonly Conversation[]>([]);
  private readonly page = signal(1);
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

  /**
   * What the API returned, unfiltered.
   *
   * The search term is sent with the request, so filtering again here is not
   * just redundant — it is wrong. The server matches message bodies too, and
   * this filter only looked at the name and number, so it silently discarded
   * conversations the server had correctly matched.
   */
  protected readonly visibleConversations = this.conversations;

  /** How many the API says exist, against how many have been fetched. */
  protected readonly totalItems = signal(0);
  protected readonly loadingMore = signal(false);

  protected readonly remaining = computed(() =>
    Math.max(0, this.totalItems() - this.conversations().length),
  );

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
      this.canReply() &&
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

    this.realtime.inboundMessages$
      .pipe(takeUntilDestroyed())
      .subscribe((event) => this.onInboundMessage(event));

    // Another agent took a conversation: reflect it without a reload.
    this.realtime.conversationAssignments$
      .pipe(takeUntilDestroyed())
      .subscribe((conversation) => this.replaceConversation(conversation));

    // Search and filters reload the list. Search used to change only the box —
    // nothing was fetched until Refresh was pressed, so it looked broken.
    toObservable(computed(() => ({ search: this.search().trim(), filters: this.filters() })))
      .pipe(
        skip(1),
        debounceTime(300),
        distinctUntilChanged((previous, next) => previous.search === next.search && previous.filters === next.filters),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        // The open thread may not match the new filters; the first result opens instead.
        this.selectedId.set(null);
        this.load();
      });

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

  /**
   * A customer message arrived while the screen was open.
   *
   * The list is updated in place and the conversation moves to the top, because
   * that is what the event carries. The **thread** is refetched instead: the
   * payload has a preview, not a message — no id, kind or attachment — and
   * inventing a bubble from a truncated string would show the customer's words
   * wrongly, then disagree with the server on the next load.
   */
  private onInboundMessage(event: InboundMessageEvent): void {
    const known = this.conversations().some((entry) => entry.id === event.conversationId);

    if (!known) {
      // A conversation this page has never seen — a brand-new customer, or one
      // beyond the loaded pages. Only a reload can place it correctly.
      this.load(true);
      return;
    }

    this.conversations.update((current) => {
      const updated = current.map((entry) =>
        entry.id === event.conversationId
          ? {
              ...entry,
              contactName: event.contactName,
              lastMessagePreview: event.preview,
              lastMessageAt: event.occurredAt,
              windowExpiresAt: event.windowExpiresAt,
              // The open thread is read as it arrives, so the badge would be a
              // lie on the conversation the user is looking at.
              unreadCount: entry.id === this.selectedId() ? 0 : event.unreadCount,
            }
          : entry,
      );

      // Newest activity first, matching the order the API returns.
      return [...updated].sort(
        (left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime(),
      );
    });

    // Restart the countdown against the new expiry without waiting for the tick.
    this.now.set(Date.now());

    if (event.conversationId === this.selectedId()) {
      this.loadThread(event.conversationId, true);
      this.whatsapp.markRead(event.conversationId).subscribe({ error: () => undefined });
    }
  }

  protected load(silent = false): void {
    if (!silent) {
      this.state.set('loading');
    }
    this.page.set(1);

    this.whatsapp.listConversations(1, CONVERSATION_PAGE_SIZE, this.search().trim(), this.filters()).subscribe({
      next: (result) => {
        this.conversations.set(result.items);
        this.totalItems.set(result.totalItems);
        this.state.set(result.totalItems === 0 ? 'empty' : 'ready');

        // Open the newest thread on first load so the pane is never blank.
        if (this.selectedId() === null && result.items.length > 0) {
          this.selectedId.set(result.items[0].id);
        }
      },
      error: (error: ApiError) => {
        this.unavailable.set(error.status === 404 || error.status === 501);
        if (!silent) {
          this.state.set('error');
        }
      },
    });
  }

  protected setFilter<K extends keyof ConversationFilters>(key: K, value: ConversationFilters[K]): void {
    this.filters.update((current) => ({ ...current, [key]: value }));
  }

  protected clearFilters(): void {
    this.search.set('');
    this.filters.set(DEFAULT_CONVERSATION_FILTERS);
  }

  /** `null` unassigns. */
  protected assign(userId: string | null): void {
    const conversation = this.selected();
    if (conversation === null || this.assigning()) {
      return;
    }
    this.assigning.set(true);
    this.whatsapp.assignConversation(conversation.id, userId).subscribe({
      next: (updated) => {
        this.assigning.set(false);
        this.replaceConversation(updated);
      },
      error: (error: ApiError) => {
        this.assigning.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  /**
   * Fetches the next page and appends it.
   *
   * This list used to ask for fifty and stop. Not "fifty then paginate" —
   * fifty, full stop: the fifty-first conversation simply did not exist as far
   * as the screen was concerned, with nothing on the page to suggest otherwise.
   * Appending suits a thread list better than page numbers, but either way the
   * rest has to be reachable.
   */
  protected loadMore(): void {
    if (this.loadingMore() || this.remaining() === 0) {
      return;
    }

    const next = this.page() + 1;
    this.loadingMore.set(true);

    this.whatsapp
      .listConversations(next, CONVERSATION_PAGE_SIZE, this.search().trim(), this.filters())
      .subscribe({
        next: (result) => {
          this.loadingMore.set(false);
          this.page.set(next);
          this.totalItems.set(result.totalItems);
          // Guards against a conversation arriving twice when its last message
          // lands between two page requests and reorders the list.
          this.conversations.update((current) => {
            const seen = new Set(current.map((entry) => entry.id));
            return [...current, ...result.items.filter((entry) => !seen.has(entry.id))];
          });
        },
        error: () => this.loadingMore.set(false),
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

  /**
   * @param silent Refresh without clearing the thread. A live message must not
   *   replace what the user is reading with skeletons.
   */
  protected loadThread(conversationId: string, silent = false): void {
    if (!silent) {
      this.threadState.set('loading');
    }

    this.whatsapp.listMessages(conversationId, 1, PAGE_SIZE).subscribe({
      next: (result) => {
        this.messages.set(result.items);
        this.threadState.set(result.totalItems === 0 ? 'empty' : 'ready');
        this.scrollToLatest();
      },
      error: () => {
        if (!silent) {
          this.threadState.set('error');
        }
      },
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
    // Through the conversation's own number: Meta's handle only works there.
    this.whatsapp.uploadMedia(file, kind, this.selected()?.accountId).subscribe({
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
          if (error.errorCode === 'not_connected') {
            this.toast.error(
              'WhatsApp is not connected',
              'Reconnect your WhatsApp Business number before replying.',
            );
            return;
          }
          if (error.errorCode === 'media_not_uploaded') {
            // The handle is dead, so keeping it in the composer only invites a
            // second identical failure.
            this.attachment.set(null);
            this.toast.error(
              'The attachment did not upload',
              'Attach the file again and resend.',
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
