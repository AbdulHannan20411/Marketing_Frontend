import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DestroyRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  ImportBatch,
  ImportErrorCode,
  ImportFieldMapping,
  ImportRow,
  ImportTargetField,
} from '@core/models/contact-import.model';
import {
  IMPORT_TARGET_FIELDS,
  describeFileSize,
  importErrorLabel,
  importErrorMessage,
  isImportInFlight,
  isTerminalImportStatus,
  unmappedRequiredFields,
} from '@core/models/contact-import.model';
import { ContactImportService, type ImportRowFilter } from '@core/services/contact-import.service';
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

/**
 * One import batch, from parsed file to committed contacts.
 *
 * The page follows the batch through `ImportNotificationService`, which prefers
 * the hub and falls back to a backing-off poll. Watching stops as soon as the
 * batch settles — either it finished, or it is waiting for the mapping below —
 * and starts again after the user acts.
 */
@Component({
  selector: 'app-import-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
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
  ],
  templateUrl: './import-detail.component.html',
})
export class ImportDetailComponent {
  /** Bound from the route parameter. */
  readonly batchId = input.required<string>();

  private readonly imports = inject(ContactImportService);
  private readonly exports = inject(ImportExportService);
  private readonly notifications = inject(ImportNotificationService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private watchSubscription: Subscription | null = null;

  protected readonly targetFields = IMPORT_TARGET_FIELDS;
  protected readonly skeletons = [1, 2, 3, 4, 5];
  protected readonly isLive = this.notifications.isLive;

  protected readonly state = signal<LoadState>('loading');
  protected readonly batch = signal<ImportBatch | null>(null);

  /** Working copy of the mapping; only sent when the user saves it. */
  protected readonly draftMapping = signal<ImportFieldMapping>({});

  protected readonly rows = signal<readonly ImportRow[]>([]);
  protected readonly rowsState = signal<LoadState>('idle');
  protected readonly rowPage = signal(1);
  protected readonly rowPageSize = signal(DEFAULT_PAGE_SIZE);
  protected readonly rowTotal = signal(0);
  protected readonly rowFilter = signal<ImportRowFilter>('all');

  protected readonly savingMapping = signal(false);
  protected readonly committing = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly exporting = signal(false);
  protected readonly exportLabel = signal<string | null>(null);

  protected readonly breadcrumbs = computed(() => [
    { label: 'Contacts', route: '/contacts' },
    { label: 'Import', route: '/contacts/import' },
    { label: this.batch()?.fileName ?? 'Batch', route: null },
  ]);

  protected readonly statistics = computed(() => this.batch()?.statistics ?? null);
  protected readonly inFlight = computed(() => {
    const batch = this.batch();
    return batch !== null && isImportInFlight(batch.status);
  });

  protected readonly isSettled = computed(() => {
    const batch = this.batch();
    return batch !== null && isTerminalImportStatus(batch.status);
  });

  /**
   * Cancel disappears once committing starts — the API returns 409 from that
   * point because contacts are already in the audience, and offering a button
   * that can only fail is worse than not offering one.
   */
  protected readonly canCancel = computed(() => {
    const status = this.batch()?.status;
    return status === 'pending' || status === 'processing' || status === 'awaitingMapping';
  });

  protected readonly canEditMapping = computed(() => this.batch()?.status === 'awaitingMapping');

  protected readonly missingRequired = computed(() => unmappedRequiredFields(this.draftMapping()));

  protected readonly canCommit = computed(
    () => this.canEditMapping() && this.missingRequired().length === 0 && !this.committing(),
  );

  /** Rows the preview can show; only meaningful once the file has been parsed. */
  protected readonly hasParsedRows = computed(() => (this.batch()?.detectedColumns.length ?? 0) > 0);

  protected readonly previewColumns = computed(() => this.batch()?.detectedColumns ?? []);

  constructor() {
    // Re-arm whenever the route lands on a different batch — and *only* then.
    // The work below reads and writes the batch and row signals, so without
    // `untracked` the effect would depend on its own output and reset the page
    // every time a poll came back.
    effect(() => {
      const id = this.batchId();
      untracked(() => {
        this.resetFor(id);
        this.watch(id);
        this.loadRows();
      });
    });

    this.destroyRef.onDestroy(() => this.watchSubscription?.unsubscribe());
  }

  /* ------------------------------ loading ------------------------------ */

  private resetFor(_batchId: string): void {
    this.state.set('loading');
    this.batch.set(null);
    this.rows.set([]);
    this.rowPage.set(1);
    this.rowFilter.set('all');
  }

  /** Follows the batch until it settles. Safe to call again; the old watch is dropped. */
  private watch(batchId: string): void {
    this.watchSubscription?.unsubscribe();

    let previousStatus: string | null = null;

    this.watchSubscription = this.notifications.watch(batchId).subscribe({
      next: (batch) => {
        const wasEditing = this.canEditMapping();
        this.batch.set(batch);
        this.state.set('ready');

        // Do not stamp on a mapping the user is part-way through editing.
        if (!wasEditing) {
          this.draftMapping.set(batch.mapping);
        }

        // Counts change as the worker runs; the preview should follow.
        if (previousStatus !== null && previousStatus !== batch.status) {
          this.loadRows();
        }
        previousStatus = batch.status;
      },
      error: () => this.state.set('error'),
    });
  }

  protected reload(): void {
    this.watch(this.batchId());
    this.loadRows();
  }

  protected loadRows(): void {
    this.rowsState.set('loading');

    this.imports
      .getImportRows(this.batchId(), this.rowPage(), this.rowPageSize(), this.rowFilter())
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.rowTotal.set(result.totalItems);
          this.rowsState.set(result.totalItems === 0 ? 'empty' : 'ready');
        },
        error: () => this.rowsState.set('error'),
      });
  }

  protected setRowFilter(filter: ImportRowFilter): void {
    this.rowFilter.set(filter);
    this.rowPage.set(1);
    this.loadRows();
  }

  protected onRowPageChange(page: number): void {
    this.rowPage.set(page);
    this.loadRows();
  }

  protected onRowPageSizeChange(size: number): void {
    this.rowPageSize.set(size);
    this.rowPage.set(1);
    this.loadRows();
  }

  /* ------------------------------ mapping ------------------------------ */

  protected mappedColumn(field: ImportTargetField): string {
    return this.draftMapping()[field] ?? '';
  }

  protected setMapping(field: ImportTargetField, column: string): void {
    this.draftMapping.update((mapping) => ({ ...mapping, [field]: column === '' ? null : column }));
  }

  protected saveMapping(): void {
    if (this.savingMapping() || !this.canEditMapping()) {
      return;
    }
    this.savingMapping.set(true);

    this.imports.saveMapping(this.batchId(), this.draftMapping()).subscribe({
      next: (batch) => {
        this.savingMapping.set(false);
        this.batch.set(batch);
        this.toast.success('Mapping saved', 'Ready to import when you are.');
        this.loadRows();
      },
      error: (error: ApiError) => {
        this.savingMapping.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  /* ------------------------------ actions ------------------------------ */

  protected commit(): void {
    if (!this.canCommit()) {
      return;
    }
    this.committing.set(true);

    this.imports.commitImport(this.batchId()).subscribe({
      next: () => {
        this.committing.set(false);
        this.toast.success(
          'Import started',
          'Your contacts are being imported in the background. You can leave this page safely.',
        );
        // Queued, not done — pick the batch back up and follow it.
        this.watch(this.batchId());
      },
      error: (error: ApiError) => {
        this.committing.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected cancel(): void {
    if (this.cancelling()) {
      return;
    }
    this.cancelling.set(true);

    this.imports.cancelImport(this.batchId()).subscribe({
      next: (batch) => {
        this.cancelling.set(false);
        this.batch.set(batch);
        this.toast.success('Import cancelled', 'Nothing further will be imported from this file.');
      },
      error: (error: ApiError) => {
        this.cancelling.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  /** The failed count is the handle for this — see the statistics row. */
  protected exportFailed(): void {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(true);
    this.exportLabel.set('Requesting…');

    this.exports.run(this.batchId()).subscribe({
      next: (job) => {
        if (job.status === 'completed') {
          this.exporting.set(false);
          this.exportLabel.set(null);
          this.toast.success('Failed records ready', `${job.rowCount} rows downloaded.`);
        } else if (job.status === 'failed') {
          this.exporting.set(false);
          this.exportLabel.set(null);
          this.toast.error(
            'Export failed',
            job.failureReason ?? 'The workbook could not be generated.',
          );
        } else {
          this.exportLabel.set('Preparing workbook…');
        }
      },
      error: (error: ApiError) => {
        this.exporting.set(false);
        this.exportLabel.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected backToHistory(): void {
    void this.router.navigate(['/contacts/import']);
  }

  /* ------------------------------ helpers ------------------------------ */

  protected describe(bytes: number): string {
    return describeFileSize(bytes);
  }

  protected errorText(row: ImportRow): string {
    return row.errors.map(importErrorMessage).join(' ');
  }

  protected errorLabel(code: ImportErrorCode): string {
    return importErrorLabel(code);
  }
}
