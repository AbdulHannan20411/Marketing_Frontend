import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { Observable } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import type { Campaign, CampaignStatus } from '@core/models/campaign.model';
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

  private readonly filtered = computed(() => {
    const status = this.statusFilter();
    const term = this.search().trim().toLowerCase();

    return this.campaigns().filter((campaign) => {
      const matchesStatus = status === 'all' || campaign.status === status;
      const matchesSearch =
        term === '' ||
        campaign.name.toLowerCase().includes(term) ||
        campaign.templateName.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  });

  protected readonly totalItems = computed(() => this.filtered().length);

  protected readonly visibleCampaigns = computed(() => {
    const size = this.pageSize();
    const start = (this.page() - 1) * size;
    return this.filtered().slice(start, start + size);
  });

  protected readonly tableState = computed<LoadState>(() => {
    const state = this.state();
    if (state !== 'ready') {
      return state;
    }
    return this.totalItems() === 0 ? 'empty' : 'ready';
  });

  protected readonly totals = computed(() => {
    const all = this.campaigns();
    const sent = all.reduce((sum, campaign) => sum + campaign.metrics.sent, 0);
    const delivered = all.reduce((sum, campaign) => sum + campaign.metrics.delivered, 0);
    const read = all.reduce((sum, campaign) => sum + campaign.metrics.read, 0);

    return {
      active: all.filter((c) => c.status === 'sending' || c.status === 'scheduled').length,
      sent,
      deliveryRate: sent === 0 ? 0 : Number(((delivered / sent) * 100).toFixed(1)),
      readRate: delivered === 0 ? 0 : Number(((read / delivered) * 100).toFixed(1)),
    };
  });

  constructor() {
    this.load();

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
    this.campaignsService.list().subscribe({
      next: (campaigns) => {
        this.campaigns.set(campaigns);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  private upsert(updated: Campaign): void {
    this.campaigns.update((current) => {
      const index = current.findIndex((candidate) => candidate.id === updated.id);
      if (index === -1) {
        return [updated, ...current];
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

  protected onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
  }

  protected setStatus(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.page.set(1);
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.page.set(1);
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
