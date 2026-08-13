import type {
  ImportBatch,
  ImportBatchStatus,
  ImportProgressEvent,
  ImportCommitAccepted,
  ImportErrorCode,
  ImportErrorGroup,
  ImportExportJob,
  ImportExportStatus,
  ImportFieldMapping,
  ImportPlanLimit,
  ImportRow,
  ImportRowError,
  ImportRowStatus,
  ImportBatchSummary,
  ImportStatistics,
  ImportUploadAccepted,
} from '@core/models/contact-import.model';

/* ------------------------------------------------------------------ *
 * Wire shapes
 *
 * These mirror the API exactly, including its PascalCase enums. Nothing
 * outside this file sees them: services map straight into the domain models
 * so a contract change lands here and nowhere else.
 * ------------------------------------------------------------------ */

export type ImportBatchStatusDto =
  | 'Pending'
  | 'Processing'
  | 'AwaitingMapping'
  | 'Committing'
  | 'Completed'
  | 'CompletedWithErrors'
  | 'Failed'
  | 'Cancelled';

export type ImportRowStatusDto =
  | 'Pending'
  | 'Valid'
  | 'Imported'
  | 'Updated'
  | 'Duplicate'
  | 'Skipped'
  | 'Failed';

export type ImportExportStatusDto = 'Pending' | 'Processing' | 'Completed' | 'Failed';

export interface ImportStatisticsDto {
  readonly totalRows: number;
  readonly successful: number;
  readonly updated: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface ImportRowErrorDto {
  readonly code: string;
  readonly field: string | null;
  readonly message: string;
}

export interface ImportErrorGroupDto {
  readonly code: string;
  readonly count: number;
}

export interface ImportPlanLimitDto {
  readonly contactLimit: number;
  readonly currentContacts: number;
  readonly skippedForLimit: number;
}

export interface ImportFieldMappingDto {
  readonly fullName?: string | null;
  readonly phoneNumber?: string | null;
  readonly email?: string | null;
  readonly country?: string | null;
  readonly status?: string | null;
  readonly tags?: string | null;
  readonly groups?: string | null;
}

export interface ImportListItemDto {
  readonly batchId: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly status: ImportBatchStatusDto;
  readonly statistics: ImportStatisticsDto;
  readonly uploadedAt: string;
  readonly completedAt: string | null;
  readonly uploadedBy: string;
  readonly hasFailedRecords: boolean;
}

export interface ImportDetailsDto extends ImportListItemDto {
  readonly progressPercent: number;
  readonly detectedColumns: readonly string[];
  readonly suggestedMapping: ImportFieldMappingDto;
  readonly mapping: ImportFieldMappingDto | null;
  readonly errorGroups: readonly ImportErrorGroupDto[];
  readonly failureReason: string | null;
  readonly planLimit: ImportPlanLimitDto | null;
}

export interface ImportRowDto {
  readonly rowNumber: number;
  readonly status: ImportRowStatusDto;
  readonly values: Readonly<Record<string, string>>;
  readonly errors: readonly ImportRowErrorDto[];
}

export interface ImportUploadResponseDto {
  readonly batchId: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly status: ImportBatchStatusDto;
  readonly uploadedAt: string;
}

export interface ImportMappingRequestDto {
  readonly mapping: ImportFieldMappingDto;
}

export interface ImportCommitResponseDto {
  readonly batchId: string;
  readonly status: ImportBatchStatusDto;
  readonly queuedAt: string;
}

export interface ImportExportResponseDto {
  readonly exportId: string;
  readonly batchId: string;
  readonly status: ImportExportStatusDto;
  readonly fileName: string | null;
  readonly rowCount: number;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly failureReason: string | null;
}

/** Pushed over SignalR whenever a worker moves a batch on. Best-effort. */
export interface ImportNotificationDto {
  readonly batchId: string;
  readonly status: ImportBatchStatusDto;
  readonly progressPercent: number;
  readonly statistics: ImportStatisticsDto;
  readonly failureReason: string | null;
}

/* ------------------------------------------------------------------ *
 * Mappers
 * ------------------------------------------------------------------ */

const BATCH_STATUS: Readonly<Record<ImportBatchStatusDto, ImportBatchStatus>> = {
  Pending: 'pending',
  Processing: 'processing',
  AwaitingMapping: 'awaitingMapping',
  Committing: 'committing',
  Completed: 'completed',
  CompletedWithErrors: 'completedWithErrors',
  Failed: 'failed',
  Cancelled: 'cancelled',
};

const ROW_STATUS: Readonly<Record<ImportRowStatusDto, ImportRowStatus>> = {
  Pending: 'pending',
  Valid: 'valid',
  Imported: 'imported',
  Updated: 'updated',
  Duplicate: 'duplicate',
  Skipped: 'skipped',
  Failed: 'failed',
};

const EXPORT_STATUS: Readonly<Record<ImportExportStatusDto, ImportExportStatus>> = {
  Pending: 'pending',
  Processing: 'processing',
  Completed: 'completed',
  Failed: 'failed',
};

const ERROR_CODES: readonly ImportErrorCode[] = [
  'InvalidPhoneNumber',
  'MissingRequiredField',
  'InvalidEmail',
  'DuplicateContact',
  'DuplicateInFile',
  'UnsupportedColumn',
  'InvalidCountry',
  'DatabaseError',
  'PlanLimitExceeded',
];

/**
 * An unrecognised status is treated as still running rather than finished, so
 * a contract addition never makes a live batch look complete. Watchers have
 * their own attempt ceiling, so this cannot poll forever.
 */
function toBatchStatus(value: ImportBatchStatusDto): ImportBatchStatus {
  return BATCH_STATUS[value] ?? 'processing';
}

function toErrorCode(value: string): ImportErrorCode {
  return ERROR_CODES.includes(value as ImportErrorCode)
    ? (value as ImportErrorCode)
    : 'DatabaseError';
}

function toStatistics(dto: ImportStatisticsDto): ImportStatistics {
  return {
    totalRows: dto.totalRows,
    successful: dto.successful,
    updated: dto.updated,
    duplicates: dto.duplicates,
    failed: dto.failed,
    skipped: dto.skipped,
  };
}

function toRowError(dto: ImportRowErrorDto): ImportRowError {
  return { code: toErrorCode(dto.code), field: dto.field, message: dto.message };
}

function toErrorGroup(dto: ImportErrorGroupDto): ImportErrorGroup {
  return { code: toErrorCode(dto.code), count: dto.count };
}

function toPlanLimit(dto: ImportPlanLimitDto | null): ImportPlanLimit | null {
  return dto === null
    ? null
    : {
        contactLimit: dto.contactLimit,
        currentContacts: dto.currentContacts,
        skippedForLimit: dto.skippedForLimit,
      };
}

function toMapping(dto: ImportFieldMappingDto | null | undefined): ImportFieldMapping {
  return {
    fullName: dto?.fullName ?? null,
    phoneNumber: dto?.phoneNumber ?? null,
    email: dto?.email ?? null,
    country: dto?.country ?? null,
    status: dto?.status ?? null,
    tags: dto?.tags ?? null,
    groups: dto?.groups ?? null,
  };
}

export function toImportBatchSummary(dto: ImportListItemDto): ImportBatchSummary {
  return {
    batchId: dto.batchId,
    fileName: dto.fileName,
    fileSizeBytes: dto.fileSizeBytes,
    status: toBatchStatus(dto.status),
    statistics: toStatistics(dto.statistics),
    uploadedAt: dto.uploadedAt,
    completedAt: dto.completedAt,
    uploadedBy: dto.uploadedBy,
    hasFailedRecords: dto.hasFailedRecords,
  };
}

export function toImportBatch(dto: ImportDetailsDto): ImportBatch {
  const suggested = toMapping(dto.suggestedMapping);
  return {
    ...toImportBatchSummary(dto),
    progressPercent: dto.progressPercent,
    detectedColumns: dto.detectedColumns,
    suggestedMapping: suggested,
    // Until the user saves one, the suggestion *is* the mapping.
    mapping: dto.mapping === null ? suggested : toMapping(dto.mapping),
    errorGroups: dto.errorGroups.map(toErrorGroup),
    failureReason: dto.failureReason,
    planLimit: toPlanLimit(dto.planLimit),
  };
}

export function toImportRow(dto: ImportRowDto): ImportRow {
  return {
    rowNumber: dto.rowNumber,
    status: ROW_STATUS[dto.status] ?? 'pending',
    values: dto.values,
    errors: dto.errors.map(toRowError),
  };
}

export function toImportUploadAccepted(dto: ImportUploadResponseDto): ImportUploadAccepted {
  return {
    batchId: dto.batchId,
    fileName: dto.fileName,
    fileSizeBytes: dto.fileSizeBytes,
    status: toBatchStatus(dto.status),
    uploadedAt: dto.uploadedAt,
  };
}

export function toImportCommitAccepted(dto: ImportCommitResponseDto): ImportCommitAccepted {
  return {
    batchId: dto.batchId,
    status: toBatchStatus(dto.status),
    queuedAt: dto.queuedAt,
  };
}

export function toImportExportJob(dto: ImportExportResponseDto): ImportExportJob {
  return {
    exportId: dto.exportId,
    batchId: dto.batchId,
    status: EXPORT_STATUS[dto.status] ?? 'processing',
    fileName: dto.fileName,
    rowCount: dto.rowCount,
    requestedAt: dto.requestedAt,
    completedAt: dto.completedAt,
    failureReason: dto.failureReason,
  };
}

/** Partial batch delivered by the hub, ready to merge over the cached one. */
export function toImportProgress(dto: ImportNotificationDto): ImportProgressEvent {
  return {
    batchId: dto.batchId,
    status: toBatchStatus(dto.status),
    progressPercent: dto.progressPercent,
    statistics: toStatistics(dto.statistics),
    failureReason: dto.failureReason ?? null,
  };
}

/* ---------------------------- outbound ---------------------------- */

export function toMappingRequest(mapping: ImportFieldMapping): ImportMappingRequestDto {
  return {
    mapping: {
      fullName: mapping.fullName ?? null,
      phoneNumber: mapping.phoneNumber ?? null,
      email: mapping.email ?? null,
      country: mapping.country ?? null,
      status: mapping.status ?? null,
      tags: mapping.tags ?? null,
      groups: mapping.groups ?? null,
    },
  };
}

const ROW_STATUS_WIRE: Readonly<Record<ImportRowStatus, ImportRowStatusDto>> = {
  pending: 'Pending',
  valid: 'Valid',
  imported: 'Imported',
  updated: 'Updated',
  duplicate: 'Duplicate',
  skipped: 'Skipped',
  failed: 'Failed',
};

/**
 * The rows filter goes back over the wire in the API's casing.
 *
 * This matters: an unrecognised value matches *nothing* server-side rather than
 * everything, so sending `failed` instead of `Failed` would quietly show an
 * empty table and read as "no failures".
 */
export function toRowStatusDto(status: ImportRowStatus | 'all'): string {
  return status === 'all' ? 'all' : ROW_STATUS_WIRE[status];
}
