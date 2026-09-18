import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { ApiError, LoadState } from '@core/models/api.model';
import {
  AUTO_REPLY_RANGES,
  AUTO_REPLY_TRIGGERS,
  AUTO_REPLY_TRIGGER_COPY,
  type AutoReplyDraft,
  type AutoReplySettings,
  type AutoReplyTrigger,
  autoReplyProblems,
  formatMinutes,
  formatSeconds,
} from '@core/models/auto-reply.model';
import { AutoReplyService } from '@core/services/auto-reply.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/**
 * Lets an admin hand routine first replies to the assistant.
 *
 * Two rules shape the screen. A trigger the plan does not sell is **disabled
 * and labelled**, never hidden — an admin should be able to see what an upgrade
 * buys. And when the deployment has no AI key at all, every control is inert
 * and says so, rather than accepting settings that could never run.
 */
@Component({
  selector: 'app-auto-reply',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    PageHeaderComponent,
    CardComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './auto-reply.component.html',
})
export class AutoReplyComponent {
  private readonly service = inject(AutoReplyService);
  private readonly toast = inject(ToastService);

  protected readonly breadcrumbs = [
    { label: 'Home', route: '/dashboard' },
    { label: 'WhatsApp', route: '/whatsapp' },
    { label: 'Auto-reply', route: null },
  ];
  protected readonly triggerKeys = AUTO_REPLY_TRIGGERS;
  protected readonly triggerCopy = AUTO_REPLY_TRIGGER_COPY;
  protected readonly ranges = AUTO_REPLY_RANGES;
  protected readonly skeletons = [1, 2, 3];

  protected readonly state = signal<LoadState>('loading');
  protected readonly settings = signal<AutoReplySettings | null>(null);
  protected readonly saving = signal(false);
  /** A server refusal worth showing beside the form rather than only as a toast. */
  protected readonly serverProblem = signal<string | null>(null);

  protected readonly enabled = signal(false);
  protected readonly triggers = signal<Record<AutoReplyTrigger, boolean>>({
    greeting: false,
    first_message: false,
    unanswered: false,
  });
  protected readonly delaySeconds = signal(60);
  protected readonly unansweredAfterMinutes = signal(300);
  protected readonly maxPerConversationPerDay = signal(3);
  protected readonly instructions = signal('');

  protected readonly configured = computed(() => this.settings()?.assistantConfigured === true);

  protected readonly draft = computed<AutoReplyDraft>(() => ({
    enabled: this.enabled(),
    triggers: this.triggers(),
    delaySeconds: this.delaySeconds(),
    unansweredAfterMinutes: this.unansweredAfterMinutes(),
    instructions: this.instructions(),
    maxPerConversationPerDay: this.maxPerConversationPerDay(),
  }));

  protected readonly problems = computed(() =>
    this.settings() === null ? [] : autoReplyProblems(this.draft()),
  );

  protected readonly dirty = computed(() => {
    const saved = this.settings();
    if (saved === null) {
      return false;
    }
    const draft = this.draft();
    return (
      saved.enabled !== draft.enabled ||
      saved.delaySeconds !== draft.delaySeconds ||
      saved.unansweredAfterMinutes !== draft.unansweredAfterMinutes ||
      saved.maxPerConversationPerDay !== draft.maxPerConversationPerDay ||
      saved.instructions !== draft.instructions ||
      AUTO_REPLY_TRIGGERS.some((trigger) => saved.triggers[trigger] !== draft.triggers[trigger])
    );
  });

  protected readonly canSave = computed(
    () => this.configured() && this.dirty() && this.problems().length === 0 && !this.saving(),
  );

  /** The wait below only applies to the "nobody replied" occasion. */
  protected readonly unansweredChosen = computed(() => this.triggers().unanswered);

  protected readonly usedPercent = computed(() => {
    const saved = this.settings();
    if (saved === null || saved.monthlyLimit === null || saved.monthlyLimit === 0) {
      return 0;
    }
    return Math.min(100, Math.round((saved.usedThisPeriod / saved.monthlyLimit) * 100));
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.serverProblem.set(null);

    this.service.get().subscribe({
      next: (settings) => {
        this.apply(settings);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  private apply(settings: AutoReplySettings): void {
    this.settings.set(settings);
    this.enabled.set(settings.enabled);
    this.triggers.set({ ...settings.triggers });
    this.delaySeconds.set(settings.delaySeconds);
    this.unansweredAfterMinutes.set(settings.unansweredAfterMinutes);
    this.maxPerConversationPerDay.set(settings.maxPerConversationPerDay);
    this.instructions.set(settings.instructions);
  }

  protected allowed(trigger: AutoReplyTrigger): boolean {
    return this.settings()?.allowedTriggers[trigger] === true;
  }

  protected toggleTrigger(trigger: AutoReplyTrigger): void {
    if (!this.allowed(trigger) || !this.configured()) {
      return;
    }
    this.triggers.update((current) => ({ ...current, [trigger]: !current[trigger] }));
  }

  protected setNumber(
    field: 'delaySeconds' | 'unansweredAfterMinutes' | 'maxPerConversationPerDay',
    raw: string,
  ): void {
    const value = Number.parseInt(raw, 10);
    const target =
      field === 'delaySeconds'
        ? this.delaySeconds
        : field === 'unansweredAfterMinutes'
          ? this.unansweredAfterMinutes
          : this.maxPerConversationPerDay;

    // An emptied box parses as NaN, which every comparison answers false to —
    // including the range check meant to catch it.
    target.set(Number.isNaN(value) ? 0 : value);
  }

  protected describeDelay(): string {
    return formatSeconds(this.delaySeconds());
  }

  protected describeWait(): string {
    return formatMinutes(this.unansweredAfterMinutes());
  }

  protected discard(): void {
    const saved = this.settings();
    if (saved !== null) {
      this.apply(saved);
      this.serverProblem.set(null);
    }
  }

  protected save(): void {
    if (!this.canSave()) {
      return;
    }
    this.saving.set(true);
    this.serverProblem.set(null);

    this.service.update(this.draft()).subscribe({
      next: (settings) => {
        this.saving.set(false);
        this.apply(settings);
        this.toast.success(
          'Auto-reply saved',
          settings.enabled
            ? 'The assistant will answer on the occasions you chose.'
            : 'Auto-reply is off.',
        );
      },
      error: (error: ApiError) => {
        this.saving.set(false);

        if (error.errorCode === 'auto_reply_trigger_not_in_plan') {
          // The plan changed under them, so what this screen believes is
          // allowed is already stale — reload rather than argue with it.
          this.serverProblem.set(error.detail);
          this.load();
          return;
        }
        if (error.status === 422) {
          const first = Object.values(error.fieldErrors)[0]?.[0];
          this.serverProblem.set(first ?? 'Check the values and try again.');
          return;
        }
        this.serverProblem.set(
          error.status === 403
            ? 'Your plan does not include AI features.'
            : 'Could not save those settings. Please try again.',
        );
      },
    });
  }
}
