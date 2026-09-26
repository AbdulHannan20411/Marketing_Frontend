import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  ImportBatchSummary,
  ImportDuplicateStrategy,
  ImportUploadAccepted,
} from '@core/models/contact-import.model';
import { describeFileSize, isImportInFlight } from '@core/models/contact-import.model';
import { EntitlementService } from '@core/services/entitlement.service';
import { PlanGateService } from '@core/services/plan-gate.service';
import { ContactImportService } from '@core/services/contact-import.service';
import { ImportExportService } from '@core/services/import-export.service';
import { ImportNotificationService } from '@core/services/import-notification.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { serverPager } from '@shared/ui/pagination/pager';
import { serverSorter } from '@shared/ui/data-table/sort';
import { SortHeaderComponent } from '@shared/ui/data-table/sort-header.component';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { AuthService } from '@core/auth/auth.service';
import { BusinessDiscoveryComponent } from './business-discovery/business-discovery.component';
import { ImportStatusBadgeComponent } from './import-status-badge.component';
import { UploadDropzoneComponent } from './upload-dropzone/upload-dropzone.component';

/**
 * Contact import: hand a file over, then watch it from the history table.
 *
 * Nothing on this page blocks. Upload returns as soon as the API has the file,
 * and the table keeps itself current from the hub — falling back to a timer
 * that only ticks while something is actually running.
 */
@Component({
  selector: 'app-contact-import',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SortHeaderComponent,
    DecimalPipe,
    TimeAgoPipe,
    ButtonDirective,
    CardComponent,
    IconComponent,
    PageHeaderComponent,
    PaginatorComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    ImportStatusBadgeComponent,
    UploadDropzoneComponent,
    BusinessDiscoveryComponent,
  ],
  templateUrl: './contact-import.component.html',
})
export class ContactImportComponent {
  private readonly imports = inject(ContactImportService);
  private readonly auth = inject(AuthService);
  private readonly exports = inject(ImportExportService);
  private readonly notifications = inject(ImportNotificationService);
  private readonly toast = inject(ToastService);
  private readonly gate = inject(PlanGateService);
  private readonly entitlements = inject(EntitlementService);
  private readonly router = inject(Router);

  /**
   * Business discovery has its own permission, `contacts.business_import`.
   *
   * It used to ride on `contacts.import` while the dedicated key did not exist.
   * The API has since gated every discovery endpoint on the dedicated key, which
   * left the two out of step: someone holding `contacts.import` alone saw the
   * tab and then met a 403 on every call inside it. Discovery spends provider
   * credits, which uploading a file does not, so the separate key is the right
   * boundary — and the client now draws it in the same place the server does.
   */
  protected readonly canDiscover = computed(() =>
    this.auth.hasAnyPermission(['contacts.business_import']),
  );

  /** Which tab is showing. Upload stays the default and the landing tab. */
  protected readonly tab = signal<'upload' | 'discover'>('upload');

  protected setTab(next: 'upload' | 'discover'): void {
    if (next === 'discover') {
      if (!this.canDiscover()) {
        return;
      }
      /*
       * The plan is checked before the panel mounts, not inside it.
       *
       * Discovery opens a map, loads categories and geolocates on init — real
       * work, for a search the workspace cannot run. So the tab stays visible
       * and clickable, the offer arrives on the click, and the panel is never
       * built until the plan covers it.
       */
      if (
        !this.gate.allow({
          action: 'Importing business contacts',
          module: 'crm',
          included: this.entitlements.hasBusinessSearch(),
        })
      ) {
        return;
      }
    }
    this.tab.set(next);
  }

  /**
   * Answered by the dropzone before it opens the file picker.
   *
   * An arrow property rather than a method so the reference is stable across
   * change detection, and so `this` is the component when the panel calls it.
   */
  protected readonly requestUpload = (): boolean =>
    this.gate.allow({ action: 'Importing contacts', module: 'crm' });

  protected readonly breadcrumbs = [
    { label: 'Contacts', route: '/contacts' },
    { label: 'Import', route: null },
  ];

  protected readonly state = signal<LoadState>('loading');
  protected readonly batches = signal<readonly ImportBatchSummary[]>([]);
  protected readonly totalItems = signal(0);
  /** The API pages this list; `load()` reads the page and size from here. */
  /**
   * Ordering, done by the API.
   *
   * These keys are `ImportHistoryService.SortableColumns` on the server; it
   * answers a 400 naming the allowed values for anything else. The history is
   * paged server-side, so sorting has to happen there too — ordering the ten
   * rows on screen would say nothing about the rest.
   */
  protected readonly sorter = serverSorter({
    columns: [
      // The API takes `id` and `batchId` for the same column.
      { key: 'id', label: 'ID' },
      { key: 'fileName', label: 'File name' },
      { key: 'status', label: 'Status' },
      { key: 'totalRows', label: 'Total rows', initialDirection: 'desc' },
      { key: 'failedCount', label: 'Failed', initialDirection: 'desc' },
      { key: 'fileSizeBytes', label: 'File size', initialDirection: 'desc' },
      { key: 'uploadedAt', label: 'Uploaded', initialDirection: 'desc' },
      { key: 'completedAt', label: 'Completed', initialDirection: 'desc' },
    ],
    load: () => {
      // A different order is a different first page.
      this.pager.reset();
      this.load();
    },
  });

  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
  });

  protected readonly skeletons = [1, 2, 3, 4, 5];

  protected readonly uploading = signal(false);
  protected readonly accepted = signal<ImportUploadAccepted | null>(null);
  protected readonly downloadingTemplate = signal(false);
  /** Batch whose failed-record workbook is being generated. */
  protected readonly exportingId = signal<string | null>(null);

  protected readonly isLive = this.notifications.isLive;

  /** Drives the safety-net timer: it is silent once every row has settled. */
  protected readonly hasRunning = computed(() =>
    this.batches().some((batch) => isImportInFlight(batch.status)),
  );

  constructor() {
    this.load();

    this.notifications
      .refreshSignal$(() => this.hasRunning())
      .pipe(takeUntilDestroyed())
      // Silent: a background refresh must never flash the page back to skeletons.
      .subscribe(() => this.load(true));
  }

  protected load(silent = false): void {
    if (!silent) {
      this.state.set('loading');
    }

    this.imports
      .getImports(
        this.pager.page(),
        this.pager.pageSize(),
        this.sorter.key(),
        this.sorter.direction(),
      )
      .subscribe({
      next: (result) => {
        this.batches.set(result.items);
        this.totalItems.set(result.totalItems);
        this.state.set(result.totalItems === 0 ? 'empty' : 'ready');
      },
      error: () => {
        // A failed background poll must not replace a working table with an error.
        if (!silent) {
          this.state.set('error');
        }
      },
    });
  }


  protected downloadTemplate(): void {
    if (this.downloadingTemplate()) {
      return;
    }
    this.downloadingTemplate.set(true);

    this.imports.downloadTemplate().subscribe({
      next: () => this.downloadingTemplate.set(false),
      error: (error: ApiError) => {
        this.downloadingTemplate.set(false);
        this.toast.error('Template unavailable', error.detail);
      },
    });
  }

  protected upload(request: { file: File; duplicateStrategy: ImportDuplicateStrategy }): void {
    if (!this.gate.allow({ action: 'Importing contacts', module: 'crm' })) {
      return;
    }

    this.uploading.set(true);

    this.imports.uploadFile(request.file, request.duplicateStrategy).subscribe({
      next: (accepted) => {
        this.uploading.set(false);
        this.accepted.set(accepted);
        this.toast.success(
          'File accepted',
          `${accepted.fileName} is being processed in the background.`,
        );
        // Show it in the table straight away; the worker takes it from here.
        this.pager.reset();
        this.load(true);
      },
      error: (error: ApiError) => {
        this.uploading.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected openBatch(batchId: string): void {
    void this.router.navigate(['/contacts/import', batchId]);
  }

  protected dismissAccepted(): void {
    this.accepted.set(null);
  }

  /**
   * Requests the workbook and follows it to completion. The button reports the
   * job rather than freezing, because generation is queued like everything else.
   */
  protected downloadFailed(event: Event, batch: ImportBatchSummary): void {
    event.stopPropagation();
    if (this.exportingId() !== null) {
      return;
    }
    this.exportingId.set(batch.batchId);

    this.exports.run(batch.batchId).subscribe({
      next: (job) => {
        if (job.status === 'completed') {
          this.exportingId.set(null);
          this.toast.success('Failed records ready', `${job.rowCount} rows downloaded.`);
        } else if (job.status === 'failed') {
          this.exportingId.set(null);
          this.toast.error(
            'Export failed',
            job.failureReason ?? 'The workbook could not be generated.',
          );
        }
      },
      error: (error: ApiError) => {
        this.exportingId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected describe(bytes: number): string {
    return describeFileSize(bytes);
  }
}
