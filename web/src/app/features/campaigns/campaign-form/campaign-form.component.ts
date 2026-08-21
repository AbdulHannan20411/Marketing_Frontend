import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import type { Campaign } from '@core/models/campaign.model';
import type { ContactGroup } from '@core/models/contact.model';
import type { RecurrenceRule } from '@core/models/recurrence.model';
import {
  browserTimeZone,
  defaultRecurrence,
  describeFirstOccurrence,
  describeRecurrence,
  firstOccurrenceIsLater,
  formatInstant,
  validateRecurrence,
} from '@core/models/recurrence.model';
import type { MessageTemplate } from '@core/models/whatsapp.model';
import { CampaignsService, type CampaignDraft } from '@core/services/campaigns.service';
import { ContactsService } from '@core/services/contacts.service';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { RecurrenceEditorComponent } from '@shared/ui/recurrence-editor/recurrence-editor.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

type Step = 'details' | 'template' | 'audience' | 'schedule' | 'review';

const STEPS: readonly { key: Step; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'template', label: 'Template' },
  { key: 'audience', label: 'Audience' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'review', label: 'Review' },
];

/**
 * Create or edit a campaign.
 *
 * A full page rather than a dialog: five decisions, one of them a scheduler,
 * does not fit in a modal without scrolling a scroll. The steps are navigable
 * in any order — an operator editing an existing campaign usually wants one
 * field, not a five-screen march — but activation is gated on all of them.
 *
 * The three that matter are deliberately their own steps, because they are the
 * questions the operator is actually answering: what is sent, who receives it,
 * and when.
 */
@Component({
  selector: 'app-campaign-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    ModalComponent,
    RecurrenceEditorComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './campaign-form.component.html',
})
export class CampaignFormComponent {
  /** Bound from the route. Absent when creating. */
  readonly campaignId = input<string | undefined>(undefined);

  private readonly campaigns = inject(CampaignsService);
  private readonly whatsapp = inject(WhatsAppService);
  private readonly contacts = inject(ContactsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly steps = STEPS;
  protected readonly step = signal<Step>('details');
  protected readonly state = signal<LoadState>('loading');
  protected readonly saving = signal(false);
  protected readonly activating = signal(false);
  protected readonly confirmingActivate = signal(false);
  protected readonly showErrors = signal(false);

  protected readonly templates = signal<readonly MessageTemplate[]>([]);
  protected readonly groups = signal<readonly ContactGroup[]>([]);
  protected readonly existing = signal<Campaign | null>(null);

  protected readonly templateSearch = signal('');
  protected readonly groupSearch = signal('');
  protected readonly selectedTemplateId = signal('');
  protected readonly selectedGroupIds = signal<readonly string[]>([]);
  protected readonly recurrence = signal<RecurrenceRule>(defaultRecurrence());

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: [''],
  });

  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly isEdit = computed(() => this.campaignId() !== undefined);

  protected readonly title = computed(() =>
    this.isEdit() ? (this.existing()?.name ?? 'Edit campaign') : 'New campaign',
  );

  protected readonly breadcrumbs = computed(() => [
    { label: 'Campaigns', route: '/campaigns' },
    { label: this.isEdit() ? 'Edit' : 'New', route: null },
  ]);

  /* ------------------------------ derived data ------------------------------ */

  /** Meta refuses anything it has not approved, so nothing else is offered. */
  protected readonly approvedTemplates = computed(() =>
    this.templates().filter((template) => template.status === 'approved'),
  );

  protected readonly pendingTemplateCount = computed(
    () => this.templates().filter((template) => template.status === 'pending').length,
  );

  protected readonly visibleTemplates = computed(() => {
    const term = this.templateSearch().trim().toLowerCase();
    if (term === '') {
      return this.approvedTemplates();
    }
    return this.approvedTemplates().filter(
      (template) =>
        template.name.toLowerCase().includes(term) ||
        template.bodyText.toLowerCase().includes(term),
    );
  });

  protected readonly visibleGroups = computed(() => {
    const term = this.groupSearch().trim().toLowerCase();
    if (term === '') {
      return this.groups();
    }
    return this.groups().filter((group) => group.name.toLowerCase().includes(term));
  });

  protected readonly selectedTemplate = computed(
    () => this.templates().find((template) => template.id === this.selectedTemplateId()) ?? null,
  );

  protected readonly selectedGroups = computed(() =>
    this.groups().filter((group) => this.selectedGroupIds().includes(group.id)),
  );

  /**
   * Sum of the group counts — the fallback, used only when the API cannot give
   * the real figure.
   *
   * A contact in two groups is counted twice here, so it is labelled an
   * estimate. Claiming a precise number we cannot compute would be worse than
   * admitting the approximation.
   */
  protected readonly estimatedRecipients = computed(() =>
    this.selectedGroups().reduce((total, group) => total + group.contactCount, 0),
  );

  /** The deduplicated, opt-out-aware count from the API. Null until it answers. */
  protected readonly exactRecipients = signal<number | null>(null);
  protected readonly countingRecipients = signal(false);

  protected readonly recipientCount = computed(
    () => this.exactRecipients() ?? this.estimatedRecipients(),
  );

  /** Drives the `~` prefix and the caveat: both go once the real number lands. */
  protected readonly recipientCountIsExact = computed(() => this.exactRecipients() !== null);

  protected readonly overlapPossible = computed(
    () => !this.recipientCountIsExact() && this.selectedGroups().length > 1,
  );

  protected readonly audienceLabel = computed(() => {
    const chosen = this.selectedGroups();
    return chosen.length === 0 ? 'All contacts' : chosen.map((group) => group.name).join(', ');
  });

  protected readonly scheduleSummary = computed(() => describeRecurrence(this.recurrence()));

  /**
   * The first firing, when it is not the start date.
   *
   * Repeated from the schedule step onto the review and the confirmation,
   * because those are the last two places the operator sees before real
   * messages are queued, and "every 2 weeks from 5 September" firing on the
   * 14th is exactly the sort of thing to catch there rather than afterwards.
   */
  protected readonly firstRun = computed(() => {
    const rule = this.recurrence();
    if (rule.frequency === 'once' || !firstOccurrenceIsLater(rule)) {
      return null;
    }
    return describeFirstOccurrence(rule);
  });

  /* ------------------------------ validation ------------------------------ */

  protected readonly nameProblem = computed(() => {
    this.formValue();
    const value = this.form.controls.name.value.trim();
    if (value === '') {
      return 'A campaign name is required.';
    }
    if (value.length > 120) {
      return 'Keep the name under 120 characters.';
    }
    return null;
  });

  protected readonly templateProblem = computed(() =>
    this.selectedTemplateId() === '' ? 'Choose an approved template.' : null,
  );

  protected readonly audienceProblem = computed(() =>
    this.selectedGroupIds().length === 0 ? 'Choose at least one group.' : null,
  );

  protected readonly scheduleProblems = computed(() => validateRecurrence(this.recurrence()));

  /** Which steps are incomplete, so the review can point at them. */
  protected readonly incompleteSteps = computed<readonly Step[]>(() => {
    const incomplete: Step[] = [];
    if (this.nameProblem() !== null) {
      incomplete.push('details');
    }
    if (this.templateProblem() !== null) {
      incomplete.push('template');
    }
    if (this.audienceProblem() !== null) {
      incomplete.push('audience');
    }
    if (this.scheduleProblems().length > 0) {
      incomplete.push('schedule');
    }
    return incomplete;
  });

  protected readonly canActivate = computed(() => this.incompleteSteps().length === 0);

  /** A draft only needs a name — the rest can be filled in later. */
  protected readonly canSaveDraft = computed(() => this.nameProblem() === null);

  /**
   * Guards against an out-of-order response: toggling groups quickly fires
   * several previews, and the slowest must not be the one that wins.
   */
  private previewToken = 0;

  constructor() {
    effect(() => {
      const id = this.campaignId();
      untracked(() => this.load(id));
    });

    effect(() => {
      const ids = this.selectedGroupIds();
      untracked(() => this.refreshRecipientCount(ids));
    });
  }

  /**
   * Asks the API for the true recipient count.
   *
   * Falls back silently to the summed estimate when the endpoint is unavailable
   * - the wizard keeps working and simply keeps its caveat, rather than showing
   * an error for a number that is only ever advisory.
   */
  private refreshRecipientCount(groupIds: readonly string[]): void {
    const token = ++this.previewToken;

    if (groupIds.length === 0) {
      this.exactRecipients.set(null);
      this.countingRecipients.set(false);
      return;
    }

    this.countingRecipients.set(true);
    this.campaigns.previewAudience(groupIds).subscribe({
      next: (preview) => {
        if (token !== this.previewToken) {
          return;
        }
        this.exactRecipients.set(preview.recipientCount);
        this.countingRecipients.set(false);
      },
      error: () => {
        if (token !== this.previewToken) {
          return;
        }
        this.exactRecipients.set(null);
        this.countingRecipients.set(false);
      },
    });
  }

  /* ------------------------------ loading ------------------------------ */

  protected load(id: string | undefined): void {
    this.state.set('loading');

    forkJoin({
      templates: this.whatsapp.listAllTemplates(),
      groups: this.contacts.listGroups(),
    }).subscribe({
      next: ({ templates, groups }) => {
        this.templates.set(templates);
        this.groups.set(groups);

        if (id === undefined) {
          this.state.set('ready');
          return;
        }
        this.hydrate(id);
      },
      error: () => this.state.set('error'),
    });
  }

  /**
   * Fills the form from an existing campaign.
   *
   * `GET /campaigns/{id}` is preferred and falls back to the list, which is all
   * that answered before the endpoint existed.
   */
  private hydrate(id: string): void {
    this.campaigns
      .getById(id)
      .pipe(catchError(() => of(null)))
      .subscribe({
        next: (campaign) => {
          if (campaign !== null) {
            this.apply(campaign);
            return;
          }
          this.hydrateFromList(id);
        },
        error: () => this.hydrateFromList(id),
      });
  }

  private hydrateFromList(id: string): void {
    this.campaigns.list().subscribe({
      next: (campaigns) => {
        const campaign = campaigns.find((entry) => entry.id === id) ?? null;
        if (campaign === null) {
          this.state.set('error');
          return;
        }
        this.apply(campaign);
      },
      error: () => this.state.set('error'),
    });
  }

  private apply(campaign: Campaign): void {
    this.existing.set(campaign);
    this.form.patchValue({
      name: campaign.name,
      description: campaign.description ?? '',
    });

    this.selectedTemplateId.set(campaign.templateId ?? this.templateIdByName(campaign));
    this.selectedGroupIds.set(campaign.groupIds ?? this.groupIdsByLabel(campaign));
    this.recurrence.set(campaign.recurrence ?? this.recurrenceFromScheduledAt(campaign));
    this.state.set('ready');
  }

  /**
   * Last-resort matching for payloads that carry display strings but no ids.
   *
   * Matching groups by substring of the audience label picks the wrong group
   * when two share a word, which is why it runs only when `groupIds` is absent.
   * Both of these go away once every deployment returns ids.
   */
  private templateIdByName(campaign: Campaign): string {
    return this.templates().find((template) => template.name === campaign.templateName)?.id ?? '';
  }

  private groupIdsByLabel(campaign: Campaign): readonly string[] {
    return this.groups()
      .filter((group) => campaign.audienceLabel.includes(group.name))
      .map((group) => group.id);
  }

  /** A one-off `scheduledAt` expressed as a rule, for campaigns predating recurrence. */
  private recurrenceFromScheduledAt(campaign: Campaign): RecurrenceRule {
    const base = defaultRecurrence();
    if (campaign.scheduledAt === null) {
      return base;
    }
    const when = new Date(campaign.scheduledAt);
    const month = String(when.getMonth() + 1).padStart(2, '0');
    const day = String(when.getDate()).padStart(2, '0');
    const hours = String(when.getHours()).padStart(2, '0');
    const minutes = String(when.getMinutes()).padStart(2, '0');

    return {
      ...base,
      frequency: 'once',
      startDate: `${when.getFullYear()}-${month}-${day}`,
      time: `${hours}:${minutes}`,
    };
  }

  /* ------------------------------ selection ------------------------------ */

  protected goTo(step: Step): void {
    this.step.set(step);
  }

  protected next(): void {
    const index = STEPS.findIndex((entry) => entry.key === this.step());
    if (index < STEPS.length - 1) {
      this.step.set(STEPS[index + 1].key);
    }
  }

  protected back(): void {
    const index = STEPS.findIndex((entry) => entry.key === this.step());
    if (index > 0) {
      this.step.set(STEPS[index - 1].key);
    }
  }

  protected isFirstStep(): boolean {
    return this.step() === STEPS[0].key;
  }

  protected isLastStep(): boolean {
    return this.step() === STEPS[STEPS.length - 1].key;
  }

  protected selectTemplate(template: MessageTemplate): void {
    this.selectedTemplateId.set(template.id);
  }

  protected toggleGroup(group: ContactGroup): void {
    this.selectedGroupIds.update((current) =>
      current.includes(group.id)
        ? current.filter((entry) => entry !== group.id)
        : [...current, group.id],
    );
  }

  protected removeGroup(group: ContactGroup): void {
    this.selectedGroupIds.update((current) => current.filter((entry) => entry !== group.id));
  }

  protected isGroupSelected(group: ContactGroup): boolean {
    return this.selectedGroupIds().includes(group.id);
  }

  protected onRecurrenceChanged(rule: RecurrenceRule): void {
    this.recurrence.set(rule);
  }

  /* ------------------------------ saving ------------------------------ */

  private buildDraft(): CampaignDraft {
    const rule = this.recurrence();
    return {
      name: this.form.controls.name.value.trim(),
      description: this.form.controls.description.value.trim(),
      templateId: this.selectedTemplateId(),
      audienceLabel: this.audienceLabel(),
      groupIds: this.selectedGroupIds(),
      recurrence: rule,
      // Kept for the one-off path the API already understands.
      scheduledAt:
        rule.frequency === 'once' ? new Date(`${rule.startDate}T${rule.time}`).toISOString() : null,
    };
  }

  protected saveDraft(): void {
    this.showErrors.set(true);
    if (!this.canSaveDraft() || this.saving()) {
      this.step.set('details');
      return;
    }
    this.persist(false);
  }

  protected requestActivate(): void {
    this.showErrors.set(true);
    if (!this.canActivate()) {
      // Land on the first thing that is missing rather than a generic refusal.
      this.step.set(this.incompleteSteps()[0]);
      return;
    }
    this.confirmingActivate.set(true);
  }

  protected cancelActivate(): void {
    this.confirmingActivate.set(false);
  }

  protected confirmActivate(): void {
    this.confirmingActivate.set(false);
    this.persist(true);
  }

  private persist(activate: boolean): void {
    const draft = this.buildDraft();
    const existing = this.existing();
    const flag = activate ? this.activating : this.saving;
    flag.set(true);

    const request$ =
      existing === null
        ? this.campaigns.create(draft)
        : this.campaigns.update(existing.id, draft);

    request$.subscribe({
      next: (campaign) => {
        if (!activate) {
          flag.set(false);
          this.toast.success('Draft saved', `${campaign.name} is saved but not scheduled.`);
          void this.router.navigate(['/campaigns', campaign.id]);
          return;
        }
        this.scheduleAfterSave(campaign, draft);
      },
      error: (error: ApiError) => {
        flag.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  /**
   * Saving and scheduling are two calls, because the API separates them.
   *
   * A failure here leaves a saved draft rather than nothing, and says so — the
   * work is not lost, it simply is not live.
   *
   * Both the rule and the one-off instant go up together. The API takes the
   * rule when it has one; on a deployment that does not yet accept recurrence
   * the recurring case fails and lands on the draft message below, which is why
   * this attempts the call rather than pre-judging it. Once recurrence is live
   * the same code path simply starts succeeding.
   */
  private scheduleAfterSave(campaign: Campaign, draft: CampaignDraft): void {
    const rule = draft.recurrence ?? null;
    const isRecurring = rule !== null && rule.frequency !== 'once';

    this.campaigns
      .schedule(campaign.id, { recurrence: rule, scheduledAt: draft.scheduledAt ?? null })
      .subscribe({
        next: (scheduled) => {
          this.activating.set(false);
          this.toast.success('Campaign scheduled', this.scheduledMessage(scheduled, rule));
          void this.router.navigate(['/campaigns', scheduled.id]);
        },
        error: (error: ApiError) => {
          this.activating.set(false);
          this.toast.error(
            'Saved, but not scheduled',
            isRecurring
              ? `${error.detail} Recurring schedules may not be accepted yet — the campaign is saved as a draft.`
              : `${error.detail} The campaign is saved as a draft — open it to try again.`,
          );
          void this.router.navigate(['/campaigns', campaign.id]);
        },
      });
  }

  /**
   * Confirms the first firing using the instant the API computed, falling back
   * to the sentence the operator already read if it did not send one.
   */
  private scheduledMessage(campaign: Campaign, rule: RecurrenceRule | null): string {
    if (campaign.nextRunAt !== undefined && campaign.nextRunAt !== null) {
      const zone = campaign.timeZone ?? rule?.timeZone ?? browserTimeZone();
      return `First run ${formatInstant(campaign.nextRunAt, zone)}.`;
    }
    return `${campaign.name} will send as configured.`;
  }

  protected cancel(): void {
    void this.router.navigate(['/campaigns']);
  }
}
