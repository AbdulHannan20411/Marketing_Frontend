import { Injectable, inject } from '@angular/core';
import { map, tap, type Observable } from 'rxjs';

import type {
  ImportCommitResponseDto,
  ImportDetailsDto,
  ImportListItemDto,
  ImportMappingRequestDto,
  ImportRowDto,
  ImportUploadResponseDto,
} from '@core/dto/contact-import.dto';
import {
  toImportBatch,
  toImportBatchSummary,
  toImportCommitAccepted,
  toImportRow,
  toImportUploadAccepted,
  toMappingRequest,
  toRowStatusDto,
} from '@core/dto/contact-import.dto';
import type { PagedResult } from '@core/models/api.model';
import type {
  ImportBatch,
  ImportBatchSummary,
  ImportCommitAccepted,
  ImportDuplicateStrategy,
  ImportFieldMapping,
  ImportRow,
  ImportRowStatus,
  ImportUploadAccepted,
} from '@core/models/contact-import.model';
import { DEFAULT_DUPLICATE_STRATEGY } from '@core/models/contact-import.model';
import { ApiService } from './api.service';
import { saveBlob } from './contacts.service';

/** Sits under the versioned base, so the full path is `/api/v1/contact-imports`. */
const BASE = '/contact-imports';

export type ImportRowFilter = ImportRowStatus | 'all';

function toPagedDomain<TDto, TDomain>(
  page: PagedResult<TDto>,
  project: (dto: TDto) => TDomain,
): PagedResult<TDomain> {
  return {
    items: page.items.map(project),
    page: page.page,
    pageSize: page.pageSize,
    totalItems: page.totalItems,
    totalPages: page.totalPages,
  };
}

/**
 * Transport for the contact import pipeline.
 *
 * Every call here is short. Upload only hands the file over, and commit only
 * queues the work — both return as soon as the API has accepted the request,
 * and progress arrives separately through `ImportNotificationService`.
 *
 * The tenant is never named by the client: the API resolves it from the bearer
 * token and scopes every batch, row and generated file to it.
 */
@Injectable({ providedIn: 'root' })
export class ContactImportService {
  private readonly api = inject(ApiService);

  /** Blank CSV with the expected headers and one worked example row. */
  downloadTemplate(): Observable<Blob> {
    return this.api
      .download(`${BASE}/template`)
      .pipe(tap((blob) => saveBlob(blob, 'contact-import-template.csv')));
  }

  /**
   * Hands the file over. Resolves once the API has stored and queued it —
   * parsing happens on a worker, so callers must not wait for a result.
   *
   * The duplicate strategy is fixed here because the parse classifies rows
   * against it; there is no way to change it later.
   */
  uploadFile(
    file: File,
    duplicateStrategy: ImportDuplicateStrategy = DEFAULT_DUPLICATE_STRATEGY,
  ): Observable<ImportUploadAccepted> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('duplicateStrategy', duplicateStrategy);
    return this.api
      .upload<ImportUploadResponseDto>(BASE, form)
      .pipe(map(toImportUploadAccepted));
  }

  getImports(page: number, pageSize: number): Observable<PagedResult<ImportBatchSummary>> {
    return this.api
      .get<PagedResult<ImportListItemDto>>(BASE, { page, pageSize })
      .pipe(map((result) => toPagedDomain(result, toImportBatchSummary)));
  }

  getImport(batchId: string): Observable<ImportBatch> {
    return this.api.get<ImportDetailsDto>(`${BASE}/${batchId}`).pipe(map(toImportBatch));
  }

  getImportRows(
    batchId: string,
    page: number,
    pageSize: number,
    status: ImportRowFilter = 'all',
  ): Observable<PagedResult<ImportRow>> {
    return this.api
      .get<PagedResult<ImportRowDto>>(`${BASE}/${batchId}/rows`, {
        page,
        pageSize,
        status: toRowStatusDto(status),
      })
      .pipe(map((result) => toPagedDomain(result, toImportRow)));
  }

  saveMapping(batchId: string, mapping: ImportFieldMapping): Observable<ImportBatch> {
    return this.api
      .put<ImportDetailsDto, ImportMappingRequestDto>(
        `${BASE}/${batchId}/mapping`,
        toMappingRequest(mapping),
      )
      .pipe(map(toImportBatch));
  }

  /**
   * Queues the import. No body — everything it needs was settled at upload and
   * in the saved mapping. The response confirms the queue, not the outcome.
   */
  commitImport(batchId: string): Observable<ImportCommitAccepted> {
    return this.api
      .post<ImportCommitResponseDto>(`${BASE}/${batchId}/commit`)
      .pipe(map(toImportCommitAccepted));
  }

  /** Rejected with 409 once committing has started — contacts are already written by then. */
  cancelImport(batchId: string): Observable<ImportBatch> {
    return this.api
      .post<ImportDetailsDto>(`${BASE}/${batchId}/cancel`)
      .pipe(map(toImportBatch));
  }
}
