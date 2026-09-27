import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { startWith, switchMap } from 'rxjs';

import type { ExportJob } from '@core/models/export.model';
import { ExportNotificationService } from '@core/services/export-notification.service';
import { ExportsService } from '@core/services/exports.service';
import { ToastService } from '@core/services/toast.service';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';

/**
 * Export centre — every export this user has asked for, and the way to get it.
 *
 * Deliberately per user rather than per workspace: an export is one person's
 * extract of data they chose, and a colleague has no reason to see that it
 * happened, still less to be handed a download.
 *
 * Kept current by push. The fallback timer only runs when the hub is down and
 * something is still moving, so an idle page on a healthy connection makes no
 * requests at all.
 */
@Component({
  selector: 'app-exports',
  standalone: true,
  imports: [DatePipe, DecimalPipe, IconComponent, PageHeaderComponent],
  templateUrl: './exports.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportsComponent implements OnInit {
  private readonly exports = inject(ExportsService);
  private readonly notifications = inject(ExportNotificationService);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly jobs = signal<readonly ExportJob[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  /** Ids with a download or retry in flight, so the button can say so. */
  readonly busy = signal<ReadonlySet<string>>(new Set());

  readonly isLive = this.notifications.isLive;

  ngOnInit(): void {
    this.notifications
      .refreshSignal$(() => ExportsService.anyRunning(this.jobs()))
      .pipe(
        startWith(undefined),
        // switchMap, so a burst of pushes while a fetch is in flight does not
        // stack requests or land them out of order.
        switchMap(() => this.exports.history()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (page) => {
          this.jobs.set(page.items);
          this.loading.set(false);
          this.failed.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  download(job: ExportJob): void {
    this.mark(job.id, true);

    this.exports
      .download(job)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.mark(job.id, false),
        error: () => {
          this.mark(job.id, false);
          this.toasts.error(
            'That export could not be downloaded',
            'It may have expired. Run it again to get a fresh file.',
          );
        },
      });
  }

  retry(job: ExportJob): void {
    this.mark(job.id, true);

    this.exports
      .retry(job.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.mark(job.id, false);
          this.notifications.announceQueued(job.datasetName, false, job.id);
        },
        error: () => {
          this.mark(job.id, false);
          this.toasts.error('That export could not be started again');
        },
      });
  }

  cancel(job: ExportJob): void {
    this.mark(job.id, true);

    this.exports
      .cancel(job.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.mark(job.id, false),
        error: () => this.mark(job.id, false),
      });
  }

  /** Human size for the row. */
  size(job: ExportJob): string {
    return ExportsService.formatSize(job.fileSizeBytes);
  }

  /** Tailwind classes for the status pill, from the design system's tokens. */
  tone(job: ExportJob): string {
    switch (job.status) {
      case 'completed':
        return 'bg-green-50 text-green-700 ring-green-200';
      case 'failed':
        return 'bg-red-50 text-red-700 ring-red-200';
      case 'processing':
      case 'queued':
        return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
      default:
        return 'bg-gray-50 text-gray-600 ring-gray-200';
    }
  }

  isBusy(job: ExportJob): boolean {
    return this.busy().has(job.id);
  }

  private mark(id: string, busy: boolean): void {
    this.busy.update((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
