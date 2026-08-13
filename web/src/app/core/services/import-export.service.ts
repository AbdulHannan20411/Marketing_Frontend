import { Injectable, inject } from '@angular/core';
import { concatMap, expand, map, of, takeWhile, tap, timer, type Observable } from 'rxjs';

import type { ImportExportResponseDto } from '@core/dto/contact-import.dto';
import { toImportExportJob } from '@core/dto/contact-import.dto';
import type { ImportExportJob } from '@core/models/contact-import.model';
import { isTerminalExportStatus } from '@core/models/contact-import.model';
import { ApiService } from './api.service';
import { saveBlob } from './contacts.service';

const BASE = '/contact-imports';

/**
 * Generating the workbook is background work too, so the delays climb the same
 * way the batch poller's do. Exports are small, so the ceiling is lower.
 */
const EXPORT_POLL_DELAYS_MS: readonly number[] = [2_000, 3_000, 5_000, 5_000, 10_000];
const MAX_EXPORT_POLLS = 40;

function exportDelay(attempt: number): number {
  return EXPORT_POLL_DELAYS_MS[Math.min(attempt, EXPORT_POLL_DELAYS_MS.length - 1)];
}

/**
 * Failed-record export: request it, wait for the worker, then download.
 *
 * The workbook is produced asynchronously, so `run` emits every status change
 * and completes once the job is terminal — a caller can drive a progress label
 * straight from it. Ownership is enforced by the API; the export is only ever
 * readable by the tenant whose batch produced it.
 */
@Injectable({ providedIn: 'root' })
export class ImportExportService {
  private readonly api = inject(ApiService);

  /** Asks for a workbook of the rows that failed. Returns immediately. */
  exportFailedRecords(batchId: string): Observable<ImportExportJob> {
    return this.api
      .post<ImportExportResponseDto>(`${BASE}/${batchId}/failed-records/export`)
      .pipe(map(toImportExportJob));
  }

  getExportStatus(exportId: string): Observable<ImportExportJob> {
    return this.api
      .get<ImportExportResponseDto>(`${BASE}/exports/${exportId}`)
      .pipe(map(toImportExportJob));
  }

  downloadExport(exportId: string, fileName: string): Observable<Blob> {
    return this.api
      .download(`${BASE}/exports/${exportId}/download`)
      .pipe(tap((blob) => saveBlob(blob, fileName)));
  }

  /**
   * The whole flow as one stream: request, follow the job, save the file.
   *
   * Emits each status so the caller can label the button, and completes after
   * the download. Polling stops the moment the job is terminal, and gives up
   * after `MAX_EXPORT_POLLS` so a stalled worker cannot leave a timer running.
   */
  run(batchId: string): Observable<ImportExportJob> {
    return this.exportFailedRecords(batchId).pipe(
      expand((job, index) =>
        isTerminalExportStatus(job.status) || index >= MAX_EXPORT_POLLS
          ? of()
          : timer(exportDelay(index)).pipe(concatMap(() => this.getExportStatus(job.exportId))),
      ),
      // `inclusive` keeps the terminal emission, which carries the file name.
      takeWhile((job) => !isTerminalExportStatus(job.status), true),
      concatMap((job) =>
        job.status === 'completed'
          ? this.downloadExport(job.exportId, job.fileName ?? `failed-records-${batchId}.xlsx`).pipe(
              map(() => job),
            )
          : of(job),
      ),
    );
  }
}
