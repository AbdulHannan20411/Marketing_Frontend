import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, type Observable } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import type { Campaign, CampaignStatus } from '@core/models/campaign.model';
import type { CampaignSummary } from '@core/services/campaigns.service';
import { CampaignsService } from '@core/services/campaigns.service';
import { RealtimeService } from '@core/services/realtime.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE } from '@shared/ui/badge/campaign-status';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { DataTableComponent, type TableColumn } from '@shared/ui/data-table/data-table.component';
import { TableRowDirective } from '@shared/ui/data-table/table-row.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { DEFAULT_PAGE_SIZE } from '@shared/ui/pagination/pagination.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { StatCardComponent } from '@shared/ui/stat-card/stat-card.component';

type StatusFilter = CampaignStatus | 'all';



/** Long enough to swallow a burst of typing, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-campaigns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    PageHeaderComponent,
    DataTableComponent,
    TableRowDirective,
    StatCardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    ModalComponent,
  ],
  templateUrl: './campaigns.component.html',
})
export class CampaignsComponent {
  private readonly campaignsService = inject(CampaignsService);
  private readonly realtime = inject(RealtimeService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** `null` = no dialog open. Destructive and costly actions are confirmed. */
  protected readonly pending = signal<{ campaign: Campaign; action: 'delete' | 'send' } | null>(
    null,
  );

  protected readonly busyId = signal<string | null>(null);
  protected readonly state = signal<LoadState>('loading');
  protected readonly campaigns = signal<readonly Campaign[]>([]);
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly search = signal('');
  protected readonly page = signal(1);

  protected readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  protected readonly statusTone = CAMPAIGN_STATUS_TONE;
  protected readonly statusLabel = CAMPAIGN_STATUS_LABEL;

  protected readonly columns: readonly TableColumn[] = [
    { key: 'name', header: 'Campaign' },
    { key: 'status', header: 'Status' },
    { key: 'audience', header: 'Audience', align: 'right', hideOnMobile: true },
    { key: 'delivered', header: 'Delivered', align: 'right', hideOnMobile: true },
    { key: 'read', header: 'Read rate', align: 'right' },
    { key: 'when', header: 'When', align: 'right', hideOnMobile: true },
    { key: 'actions', header: '', align: 'right' },
  ];

  protected readonly statuses: readonly { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'sending', label: 'Sending' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'completed', label: 'Completed' },
    { value: 'draft', label: 'Drafts' },
    { value: 'failed', label: 'Failed' },
  ];

  /**
   * The current page, exactly as the API returned it.
   *
   * No client-side filtering left: `search` and `statusFilter` are sent with
   * the request, so what arrives is already the answer. Filtering here as well
   * would quietly drop rows the server had legitimately included.
   */
  protected readonly visibleCampaigns = this.campaigns;

  protected readonly totalItems = signal(0);

  /**
   * Whether the API is doing the paging.
   *
   * False while it still returns the whole array — the service slices in that
   * case so the screen works either way. Worth keeping visible because it
   * decides where the summary tiles get their numbers.
   */
  protected readonly pagedByServer = signal(false);

  protected readonly tableState = computed<LoadState>(() => {
    const state = this.state();
    if (state !== 'ready') {
      return state;
    }
    return this.totalItems() === 0 ? 'empty' : 'ready';
  });

  /**
   * Workspace totals, from their own endpoint.
   *
   * They cannot come from the list any more. A page of ten cannot say how many
   * campaigns are active, and computing tiles from the visible rows would make
   * them change as the user pages — a "Sent" figure that moves when you click
   * Next is worse than no figure at all.
   */
  private readonly summarySnapshot = signal<CampaignSummary | null>(null);

  protected readonly totals = computed(() => {
    const summary = this.summarySnapshot();
    if (summary === null) {
      return { active: 0, sent: 0, deliveryRate: 0, readRate: 0 };
    }
    const { active, sent, delivered, read } = summary;
    return {
      active,
      sent,
      deliveryRate: sent === 0 ? 0 : Number(((delivered / sent) * 100).toFixed(1)),
      readRate: delivered === 0 ? 0 : Number(((read / delivered) * 100).toFixed(1)),
    };
  });

  /** Tiles stay blank rather than showing zeroes they cannot vouch for. */
  protected readonly hasTotals = computed(() => this.summarySnapshot() !== null);

  /** Keystrokes, before debouncing. See `onSearch`. */
  private readonly searchInput$ = new Subject<string>();

  constructor() {
    this.load();

    this.searchInput$
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        this.page.set(1);
        this.load();
      });

    // The dispatcher runs on a one-minute cadence, so progress arrives by push
    // rather than polling — the reports endpoints are rate limited to 4.
    this.realtime.campaignProgress$
      .pipe(takeUntilDestroyed())
      .subscribe((updated) => this.upsert(updated));

    // Events are not replayed, so a reconnect needs a fresh read.
    this.realtime.resynced$.pipe(takeUntilDestroyed()).subscribe(() => this.load());
  }

  /* ------------------------------ actions ------------------------------ */

  protected create(): void {
    void this.router.navigate(['/campaigns/new']);
  }

  protected open(campaign: Campaign): void {
    void this.router.navigate(['/campaigns', campaign.id]);
  }

  protected edit(campaign: Campaign): void {
    void this.router.navigate(['/campaigns', campaign.id, 'edit']);
  }

  /** Copies to a fresh draft and opens it, which is what "duplicate" is for. */
  protected duplicate(campaign: Campaign): void {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(campaign.id);

    this.campaignsService.duplicate(campaign.id).subscribe({
      next: (copy) => {
        this.busyId.set(null);
        this.toast.success('Campaign duplicated', `${copy.name} was created as a draft.`);
        void this.router.navigate(['/campaigns', copy.id, 'edit']);
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected resume(campaign: Campaign): void {
    this.runAction(campaign, (id) => this.campaignsService.resume(id), 'Campaign resumed');
  }

  /* ------------------------------ confirmations ------------------------------ */

  protected ask(campaign: Campaign, action: 'delete' | 'send'): void {
    this.pending.set({ campaign, action });
  }

  protected dismiss(): void {
    this.pending.set(null);
  }

  protected confirmPending(): void {
    const target = this.pending();
    if (target === null || this.busyId() !== null) {
      return;
    }
    this.pending.set(null);

    if (target.action === 'send') {
      this.send(target.campaign);
      return;
    }

    this.busyId.set(target.campaign.id);
    this.campaignsService.remove(target.campaign.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.campaigns.update((current) =>
          current.filter((entry) => entry.id !== target.campaign.id),
        );
        this.toast.success('Campaign deleted', `${target.campaign.name} was removed.`);
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected confirmTitle(): string {
    return this.pending()?.action === 'delete' ? 'Delete this campaign?' : 'Send this campaign now?';
  }

  protected confirmBody(): string {
    const target = this.pending();
    if (target === null) {
      return '';
    }
    return target.action === 'delete'
      ? `${target.campaign.name} and its delivery history are removed. Messages already sent are unaffected. This cannot be undone.`
      : `${target.campaign.name} starts sending to every recipient right away. Meta charges per conversation started, and a send cannot be recalled.`;
  }

  protected load(): void {
    this.state.set('loading');

    this.campaignsService
      .list({
        page: this.page(),
        pageSize: this.pageSize(),
        search: this.search().trim(),
        status: this.statusFilter(),
      })
      .subscribe({
        next: (result) => {
          this.campaigns.set(result.items);
          this.totalItems.set(result.totalItems);
          this.pagedByServer.set(result.pagedByServer);
          this.state.set('ready');

          // Present only when the whole collection was in hand, in which case
          // it is exact and there is no reason to ask twice.
          if (result.summary !== undefined) {
            this.summarySnapshot.set(result.summary);
            return;
          }

          // Only when we have none. The tiles describe the workspace, so they
          // do not change when the page or the filter does — refetching them
          // on every Next click would be exactly the wasted round trip that
          // server-side paging was meant to remove.
          if (this.summarySnapshot() === null) {
            this.loadSummary();
          }
        },
        error: () => this.state.set('error'),
      });
  }

  /** Fetched once the API pages properly and the list can no longer total. */
  private loadSummary(): void {
    this.campaignsService.summary().subscribe({
      next: (summary) => this.summarySnapshot.set(summary),
      // A failed summary must not take the list down with it: the rows are the
      // point of the screen, the tiles are a garnish. They stay blank.
      error: () => this.summarySnapshot.set(null),
    });
  }

  /**
   * Applies a live progress event to the row it belongs to.
   *
   * Only updates rows already on this page. It used to prepend an unknown
   * campaign, which was right when the array was everything — but now it would
   * inject a row the current filter and page never asked for, and push the
   * page to eleven items.
   */
  private upsert(updated: Campaign): void {
    this.campaigns.update((current) => {
      const index = current.findIndex((candidate) => candidate.id === updated.id);
      if (index === -1) {
        return current;
      }
      const next = [...current];
      next[index] = updated;
      return next;
    });
  }

  private runAction(
    campaign: Campaign,
    action: (id: string) => Observable<Campaign>,
    successMessage: string,
  ): void {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(campaign.id);

    action(campaign.id).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.upsert(updated);
        this.toast.success(successMessage, campaign.name);
        // Pausing, cancelling or sending changes the workspace totals, so the
        // tiles are stale from this moment. Dropped and refetched rather than
        // adjusted by hand: guessing the delta is how tiles drift.
        this.summarySnapshot.set(null);
        this.loadSummary();
      },
      // Business rules (invalid transition, empty audience) arrive as 409 and
      // are surfaced by the caller rather than the global handler.
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  /** Returns with status "sending" — the dispatcher completes it asynchronously. */
  protected send(campaign: Campaign): void {
    this.runAction(campaign, (id) => this.campaignsService.send(id), 'Campaign started');
  }

  protected pause(campaign: Campaign): void {
    this.runAction(campaign, (id) => this.campaignsService.pause(id), 'Campaign paused');
  }

  protected cancel(campaign: Campaign): void {
    this.runAction(campaign, (id) => this.campaignsService.cancel(id), 'Campaign cancelled');
  }

  protected canSend(campaign: Campaign): boolean {
    return campaign.status === 'draft' || campaign.status === 'scheduled';
  }

  protected canPause(campaign: Campaign): boolean {
    return campaign.status === 'sending' || campaign.status === 'scheduled';
  }

  protected canResume(campaign: Campaign): boolean {
    return campaign.status === 'paused';
  }

  /** Anything already sending or finished is past the point of editing. */
  protected canEdit(campaign: Campaign): boolean {
    return (
      campaign.status === 'draft' ||
      campaign.status === 'scheduled' ||
      campaign.status === 'paused'
    );
  }

  protected canCancel(campaign: Campaign): boolean {
    return (
      campaign.status === 'scheduled' ||
      campaign.status === 'sending' ||
      campaign.status === 'paused'
    );
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    this.load();
  }

  protected setStatus(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.page.set(1);
    this.load();
  }

  /**
   * Typing now costs a request, so it is debounced.
   *
   * Without this every keystroke is a round trip; `searchInput$` collapses a
   * burst of them into one, and `distinctUntilChanged` drops the request that
   * a backspace-and-retype would otherwise duplicate.
   */
  protected onSearch(event: Event): void {
    this.searchInput$.next((event.target as HTMLInputElement).value);
  }

  protected readRate(campaign: Campaign): number {
    const { delivered, read } = campaign.metrics;
    return delivered === 0 ? 0 : Math.round((read / delivered) * 100);
  }

  protected deliveredPercent(campaign: Campaign): number {
    const { sent, delivered } = campaign.metrics;
    return sent === 0 ? 0 : Math.round((delivered / sent) * 100);
  }

  protected timing(campaign: Campaign): string | null {
    return campaign.completedAt ?? campaign.scheduledAt ?? campaign.createdAt;
  }
}
