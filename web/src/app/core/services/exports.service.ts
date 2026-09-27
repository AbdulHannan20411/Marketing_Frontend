import { Injectable, inject } from '@angular/core';
import { tap } from 'rxjs';
import type { Observable } from 'rxjs';

import type {
  CreateExportRequest,
  ExportAccepted,
  ExportDataset,
  ExportJob,
} from '@core/models/export.model';
import type { PagedResult } from '@core/models/api.model';
import { ApiService } from './api.service';
import { saveBlob } from './contacts.service';

/**
 * Asynchronous exports of any list view.
 *
 * The contract is deliberately thin: post the view's state, get a job id, and
 * let `ExportNotificationService` deal with what happens next. Nothing here
 * waits for a file, and nothing here polls — SignalR is the mechanism.
 */
@Injectable({ providedIn: 'root' })
export class ExportsService {
  private readonly api = inject(ApiService);

  /**
   * Queues an export and returns as soon as the API has accepted it.
   *
   * Typically under a hundred milliseconds whatever the size of the list,
   * because the server writes a row and publishes a message rather than
   * reading anything.
   */
  create(request: CreateExportRequest): Observable<ExportAccepted> {
    return this.api.post<ExportAccepted, CreateExportRequest>('/exports', request);
  }

  /** The caller's own exports, newest first. */
  history(page = 1, pageSize = 20): Observable<PagedResult<ExportJob>> {
    return this.api.get<PagedResult<ExportJob>>('/exports', { page, pageSize });
  }

  /** One export's current state. The fallback when the hub is down. */
  get(jobId: string): Observable<ExportJob> {
    return this.api.get<ExportJob>(`/exports/${jobId}`);
  }

  /** What this user can export, and the columns each list offers. */
  datasets(): Observable<readonly ExportDataset[]> {
    return this.api.get<readonly ExportDataset[]>('/exports/datasets');
  }

  /**
   * Downloads a finished export.
   *
   * Through the API rather than a link to storage: the file is authorised on
   * every request — the caller must be signed in, it must be their export, and
   * it must not have expired — and a bearer token cannot ride a plain `href`.
   * The client only ever holds the job id; the storage key stays server-side.
   */
  download(job: ExportJob): Observable<Blob> {
    return this.api
      .download(`/exports/${job.id}/download`)
      .pipe(tap((blob) => saveBlob(blob, job.fileName ?? `${job.dataset}.csv`)));
  }

  /** Queues a failed export again, with the query it was created with. */
  retry(jobId: string): Observable<ExportAccepted> {
    return this.api.post<ExportAccepted>(`/exports/${jobId}/retry`);
  }

  /** Withdraws an export that has not finished. */
  cancel(jobId: string): Observable<ExportJob> {
    return this.api.post<ExportJob>(`/exports/${jobId}/cancel`);
  }

  /** Whether anything on a page of exports is still moving. */
  static anyRunning(jobs: readonly ExportJob[]): boolean {
    return jobs.some((job) => job.status === 'queued' || job.status === 'processing');
  }

  /** A size in bytes, for the history row. */
  static formatSize(bytes: number | null): string {
    if (bytes === null) {
      return '—';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
