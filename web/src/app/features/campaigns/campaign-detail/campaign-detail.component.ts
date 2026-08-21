import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import type { Campaign, CampaignRun, CampaignStatus } from '@core/models/campaign.model';
import { RUN_STATUS_LABELS } from '@core/models/campaign.model';
import {
  browserTimeZone,
  describeRecurrence,
  formatInstant,
  formatInstantShort,
} from '@core/models/recurrence.model';
import { CampaignsService } from '@core/services/campaigns.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  RUN_STATUS_TONE,
} from '@shared/ui/badge/campaign-status';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

type PendingAction = 'pause' | 'resume' | 'delete' | 'send' | 'runNow' | null;

const RUNS_PAGE_SIZE = 10;

/** Statuses that mean "this endpoint does not exist yet", not "this failed". */
const NOT_IMPLEMENTED_YET: readonly number[] = [404, 405, 501];

/**
 * One campaign: what it sends, to whom, when, and how it has performed.
 *
 * This is also where a draft is reviewed before going live, so the same three
 * answers the builder asks for are restated here in the same order.
 *
 * A recurring campaign is a definition rather than a single send, so below the
 * lifetime totals sits the history of every firing — including the occurrences
 * that were skipped, which are part of the story even though nothing went out.
 */
@Component({
  selector: 'app-campaign-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    ModalComponent,
    PaginationComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './campaign-detail.component.html',
})
export class CampaignDetailComponent {
  readonly campaignId = input.required<string>();

  private readonly campaigns = inject(CampaignsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly state = signal<LoadState>('loading');
  protected readonly campaign = signal<Campaign | null>(null);
  protected readonly busy = signal(false);
  protected readonly pending = signal<PendingAction>(null);

  protected readonly statusTone = CAMPAIGN_STATUS_TONE;
  protected readonly statusLabel = CAMPAIGN_STATUS_LABEL;
  protected readonly runTone = RUN_STATUS_TONE;
  protected readonly runLabel = RUN_STATUS_LABELS;

  /* ------------------------------ runs ------------------------------ */

  protected readonly runs = signal<readonly CampaignRun[]>([]);
  protected readonly runsState = signal<LoadState>('loading');
  protected readonly runsPage = signal(1);
  protected readonly runsPageSize = signal(RUNS_PAGE_SIZE);
  protected readonly runsTotal = signal(0);
  /**
   * True once `GET /{id}/runs` has answered with anything other than a 404.
   *
   * Until the endpoint ships the whole section stays hidden rather than showing
   * a permanently empty table, which would read as "this never ran".
   */
  protected readonly runsAvailable = signal(false);

  protected readonly breadcrumbs = computed(() => [
    { label: 'Campaigns', route: '/campaigns' },
    { label: this.campaign()?.name ?? 'Campaign', route: null },
  ]);

  /** A campaign is either recurring or one-off; never both. */
  protected readonly isRecurring = computed(() => {
    const rule = this.campaign()?.recurrence;
    return rule !== undefined && rule !== null && rule.frequency !== 'once';
  });

  /** The campaign's own zone, falling back to the rule's and then the browser's. */
  protected readonly zone = computed(() => {
    const campaign = this.campaign();
    return campaign?.timeZone ?? campaign?.recurrence?.timeZone ?? browserTimeZone();
  });

  protected readonly schedule = computed(() => {
    const campaign = this.campaign();
    if (campaign === null) {
      return null;
    }
    if (campaign.recurrence !== undefined && campaign.recurrence !== null) {
      return describeRecurrence(campaign.recurrence);
    }
    if (campaign.scheduledAt !== null) {
      return `Sends once on ${formatInstant(campaign.scheduledAt, this.zone())}.`;
    }
    return null;
  });

  /** Rendered in the campaign's zone — 9am means 9am where the business is. */
  protected readonly nextRun = computed(() => {
    const at = this.campaign()?.nextRunAt;
    return at === undefined || at === null ? null : formatInstant(at, this.zone());
  });

  protected readonly lastRun = computed(() => {
    const at = this.campaign()?.lastRunAt;
    return at === undefined || at === null ? null : formatInstant(at, this.zone());
  });

  /**
   * "Completed" only ever means something for a one-off.
   *
   * A recurring campaign that runs again on Monday has not completed, and the
   * API returns null for it — this guards the case where an older payload still
   * carries a stale value.
   */
  protected readonly completedAt = computed(() => {
    const campaign = this.campaign();
    if (campaign === null || this.isRecurring()) {
      return null;
    }
    return campaign.completedAt;
  });

  /**
   * Why the dispatcher paused this campaign, read off the newest run.
   *
   * The reason is not a field on the campaign — when an occurrence cannot go
   * out, a run is recorded as `skipped` with the explanation in its
   * `failureReason`, and that run is the newest one. A newest run that
   * `completed` means a person pressed Pause, and there is nothing to explain,
   * so no banner appears.
   */
  protected readonly pauseReason = computed(() => {
    if (this.campaign()?.status !== 'paused') {
      return null;
    }

    const newest = this.runs()[0];
    if (newest === undefined || newest.status === 'completed' || newest.status === 'running') {
      return null;
    }

    const reason = newest.failureReason;
    return reason === null || reason === '' ? null : reason;
  });

  /**
   * "5 of 12 sends" for a campaign that ends after a fixed count.
   *
   * Taken from `occurrencesRun`, which counts scheduled firings only — counting
   * rows in the run history instead would include manual and skipped runs and
   * overstate the progress, telling an operator the campaign is nearly done
   * when it has several sends left.
   */
  protected readonly occurrenceProgress = computed(() => {
    const campaign = this.campaign();
    const rule = campaign?.recurrence;

    if (
      campaign === undefined ||
      campaign === null ||
      rule === undefined ||
      rule === null ||
      rule.endCondition !== 'afterCount' ||
      rule.occurrenceCount === null
    ) {
      return null;
    }

    const run = campaign.occurrencesRun ?? 0;
    return { run, total: rule.occurrenceCount, remaining: Math.max(0, rule.occurrenceCount - run) };
  });

  protected readonly metricsTitle = computed(() =>
    this.isRecurring() ? 'All-time totals' : 'Delivery',
  );

  protected readonly metricsSubtitle = computed(() =>
    this.isRecurring()
      ? 'Summed across every run of this campaign. Per-run figures are in the history below.'
      : 'Updated as the dispatcher works through the audience.',
  );

  protected readonly deliveredPercent = computed(() => {
    const metrics = this.campaign()?.metrics;
    if (metrics === undefined || metrics.sent === 0) {
      return 0;
    }
    return Math.round((metrics.delivered / metrics.sent) * 100);
  });

  protected readonly readPercent = computed(() => {
    const metrics = this.campaign()?.metrics;
    if (metrics === undefined || metrics.delivered === 0) {
      return 0;
    }
    return Math.round((metrics.read / metrics.delivered) * 100);
  });

  protected readonly canEdit = computed(() =>
    ['draft', 'scheduled', 'paused'].includes(this.campaign()?.status ?? ''),
  );
  /**
   * Send is the one-off action: it moves the campaign to `sending` and consumes
   * the schedule. A recurring campaign is deliberately not offered it — beside
   * Run now the two buttons look interchangeable, and only one of them leaves
   * Monday's send intact. For a recurring campaign, Run now is the right door.
   */
  protected readonly canSend = computed(() => {
    const status = this.campaign()?.status ?? '';
    if (status === 'draft') {
      return true;
    }
    return status === 'scheduled' && !this.isRecurring();
  });
  protected readonly canPause = computed(() =>
    ['scheduled', 'sending'].includes(this.campaign()?.status ?? ''),
  );
  protected readonly canResume = computed(() => this.campaign()?.status === 'paused');

  /**
   * Run now is for a live schedule only — a draft is started with Send, and a
   * paused campaign has to be resumed first. Matches the API, which answers
   * `409 campaign_not_scheduled` for anything else.
   */
  protected readonly canRunNow = computed(() => this.campaign()?.status === 'scheduled');

  constructor() {
    effect(() => {
      const id = this.campaignId();
      untracked(() => {
        this.runsPage.set(1);
        this.load(id);
      });
    });
  }

  /**
   * One campaign by id, falling back to the list.
   *
   * `GET /campaigns/{id}` is still being built; until it answers, the list
   * carries everything this page displays. The fallback is what keeps the page
   * working today, and it disappears on its own the moment the endpoint lands.
   */
  protected load(id: string): void {
    this.state.set('loading');

    this.campaigns
      .getById(id)
      .pipe(catchError(() => of(null)))
      .subscribe({
        next: (campaign) => {
          if (campaign !== null) {
            this.campaign.set(campaign);
            this.state.set('ready');
            this.loadRuns(id);
            return;
          }
          this.loadFromList(id);
        },
        error: () => this.loadFromList(id),
      });
  }

  private loadFromList(id: string): void {
    this.campaigns.list().subscribe({
      next: (campaigns) => {
        const found = campaigns.find((entry) => entry.id === id) ?? null;
        this.campaign.set(found);
        this.state.set(found === null ? 'error' : 'ready');
        if (found !== null) {
          this.loadRuns(id);
        }
      },
      error: () => this.state.set('error'),
    });
  }

  protected loadRuns(id: string): void {
    this.runsState.set('loading');

    this.campaigns.listRuns(id, this.runsPage(), this.runsPageSize()).subscribe({
      next: (page) => {
        this.runsAvailable.set(true);
        this.runs.set(page.items);
        this.runsTotal.set(page.totalItems);
        this.runsState.set('ready');
      },
      error: (error: ApiError) => {
        // An endpoint that is not live yet is not an error the operator can act
        // on, so the section hides rather than shouting about it.
        //
        // 405 matters as much as 404 here: ASP.NET answers 405 when the path
        // matches an existing route template but not the method, which is what
        // an unimplemented sub-resource under `/campaigns/{id}` actually
        // returns. Keying on 404 alone would leave a permanent error card.
        this.runsAvailable.set(!NOT_IMPLEMENTED_YET.includes(error.status));
        this.runsState.set('error');
      },
    });
  }

  protected changeRunsPage(page: number): void {
    this.runsPage.set(page);
    this.loadRuns(this.campaignId());
  }

  protected changeRunsPageSize(size: number): void {
    this.runsPageSize.set(size);
    this.runsPage.set(1);
    this.loadRuns(this.campaignId());
  }

  /** `scheduledFor` in the campaign's zone, not the reader's. */
  protected runWhen(run: CampaignRun): string {
    return formatInstantShort(run.scheduledFor, this.zone());
  }

  /* ---------------------------- lifecycle ---------------------------- */

  protected ask(action: Exclude<PendingAction, null>): void {
    this.pending.set(action);
  }

  protected dismiss(): void {
    this.pending.set(null);
  }

  protected confirm(): void {
    const campaign = this.campaign();
    const action = this.pending();
    if (campaign === null || action === null || this.busy()) {
      return;
    }

    this.busy.set(true);

    // Delete returns `null` where the rest return a campaign, so the two paths
    // stay separate rather than being forced into one untyped union.
    if (action === 'delete') {
      this.campaigns.remove(campaign.id).subscribe({
        next: () => {
          this.busy.set(false);
          this.pending.set(null);
          this.toast.success('Campaign deleted', `${campaign.name} was removed.`);
          void this.router.navigate(['/campaigns']);
        },
        error: (error: ApiError) => this.fail(error),
      });
      return;
    }

    // Run now answers with the run it created, not the campaign — the schedule
    // is deliberately untouched, so there is nothing about the campaign to
    // update beyond prepending the new row.
    if (action === 'runNow') {
      this.campaigns.runNow(campaign.id).subscribe({
        next: (run) => {
          this.busy.set(false);
          this.pending.set(null);
          this.runsAvailable.set(true);
          this.runs.update((current) => [run, ...current.filter((one) => one.id !== run.id)]);
          this.runsTotal.update((total) => total + 1);
          this.toast.success(
            'Run started',
            `Sending now. ${campaign.name} still runs on its schedule.`,
          );
        },
        error: (error: ApiError) => this.fail(error),
      });
      return;
    }

    const request$ =
      action === 'pause'
        ? this.campaigns.pause(campaign.id)
        : action === 'resume'
          ? this.campaigns.resume(campaign.id)
          : this.campaigns.send(campaign.id);

    request$.subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.pending.set(null);
        this.campaign.set(updated);
        this.toast.success(
          action === 'pause'
            ? 'Campaign paused'
            : action === 'resume'
              ? updated.status === 'completed'
                ? 'Campaign completed'
                : 'Campaign resumed'
              : 'Campaign sending',
          action === 'pause'
            ? 'Nothing further will send until you resume it.'
            : action === 'resume'
              ? this.resumeMessage(updated)
              : 'Delivery has started.',
        );
      },
      error: (error: ApiError) => this.fail(error),
    });
  }

  /**
   * Resuming recomputes the next run from now rather than restoring the one it
   * had — a campaign paused for three weeks does not wake up owing three sends,
   * and saying when it next fires is the clearest way to convey that.
   *
   * A rule with no occurrences left resumes straight to `completed`. That is
   * the one outcome the operator cannot have expected from pressing Resume, so
   * it gets said plainly rather than left to be inferred from the badge.
   */
  private resumeMessage(campaign: Campaign): string {
    if (campaign.status === 'completed') {
      return 'Its schedule had no runs left, so the campaign is now complete.';
    }
    const at = campaign.nextRunAt;
    if (at === undefined || at === null) {
      return 'It will continue on its schedule.';
    }
    return `Next run ${formatInstant(at, this.zone())}.`;
  }

  private fail(error: ApiError): void {
    this.busy.set(false);
    this.pending.set(null);
    this.toast.error(error.title, error.detail);
  }

  protected duplicate(): void {
    const campaign = this.campaign();
    if (campaign === null || this.busy()) {
      return;
    }
    this.busy.set(true);

    this.campaigns.duplicate(campaign.id).subscribe({
      next: (copy) => {
        this.busy.set(false);
        this.toast.success('Campaign duplicated', `${copy.name} was created as a draft.`);
        void this.router.navigate(['/campaigns', copy.id, 'edit']);
      },
      error: (error: ApiError) => {
        this.busy.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  /* ---------------------------- confirm copy ---------------------------- */

  protected confirmTitle(): string {
    switch (this.pending()) {
      case 'pause':
        return 'Pause this campaign?';
      case 'resume':
        return 'Resume this campaign?';
      case 'send':
        return 'Send this campaign now?';
      case 'runNow':
        return 'Run this campaign now?';
      case 'delete':
        return 'Delete this campaign?';
      default:
        return '';
    }
  }

  protected confirmBody(): string {
    const campaign = this.campaign();
    const name = campaign?.name ?? 'This campaign';
    switch (this.pending()) {
      case 'pause':
        return `${name} stops sending immediately. Messages already delivered are unaffected, and you can resume at any time.`;
      case 'resume':
        return `${name} continues on its schedule. The next run is recalculated from now, so nothing missed while it was paused is sent retroactively.`;
      case 'send':
        return `${name} starts sending to every recipient right away. Meta charges per conversation started, and a send cannot be recalled.`;
      case 'runNow': {
        const recipients = campaign?.metrics.audienceSize ?? 0;
        const next = this.nextRun();
        const schedule =
          next === null
            ? 'Its schedule is unaffected.'
            : `Its schedule is unaffected — it still runs ${next}.`;
        return `${name} sends to roughly ${recipients.toLocaleString()} recipients right away. ${schedule} Meta charges per conversation started, and a send cannot be recalled.`;
      }
      case 'delete':
        return `${name} and its delivery history are removed. Messages already sent are unaffected. This cannot be undone.`;
      default:
        return '';
    }
  }

  protected confirmLabel(): string {
    switch (this.pending()) {
      case 'pause':
        return 'Pause campaign';
      case 'resume':
        return 'Resume campaign';
      case 'send':
        return 'Send now';
      case 'runNow':
        return 'Run now';
      case 'delete':
        return 'Delete campaign';
      default:
        return 'Confirm';
    }
  }

  protected isDestructive(): boolean {
    return this.pending() === 'delete';
  }

  protected statusOf(): CampaignStatus {
    return this.campaign()?.status ?? 'draft';
  }
}
