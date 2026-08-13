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
import { ContactImportService } from '@core/services/contact-import.service';
import { ImportExportService } from '@core/services/import-export.service';
import { ImportNotificationService } from '@core/services/import-notification.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { DEFAULT_PAGE_SIZE, PaginationComponent } from '@shared/ui/pagination/pagination.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
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
    DecimalPipe,
    TimeAgoPipe,
    ButtonDirective,
    CardComponent,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    ImportStatusBadgeComponent,
    UploadDropzoneComponent,
  ],
  templateUrl: './contact-import.component.html',
})
export class ContactImportComponent {
  private readonly imports = inject(ContactImportService);
  private readonly exports = inject(ImportExportService);
  private readonly notifications = inject(ImportNotificationService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly breadcrumbs = [
    { label: 'Contacts', route: '/contacts' },
    { label: 'Import', route: null },
  ];

  protected readonly state = signal<LoadState>('loading');
  protected readonly batches = signal<readonly ImportBatchSummary[]>([]);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  protected readonly totalItems = signal(0);
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

    this.imports.getImports(this.page(), this.pageSize()).subscribe({
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

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    this.load();
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
        this.page.set(1);
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
