/* ------------------------------------------------------------------ *
 * Batch lifecycle
 * ------------------------------------------------------------------ */

/**
 * Where a batch is in its life.
 *
 * Upload only *accepts* a file — parsing and importing both happen on a worker,
 * so the client never blocks on either. `awaitingMapping` is the pause where the
 * user confirms which column feeds which field; everything else is the worker's.
 */
export type ImportBatchStatus =
  | 'pending'
  | 'processing'
  | 'awaitingMapping'
  | 'committing'
  | 'completed'
  | 'completedWithErrors'
  | 'failed'
  | 'cancelled';

/** Nothing further will happen on its own — stop watching when one of these lands. */
export const TERMINAL_IMPORT_STATUSES: readonly ImportBatchStatus[] = [
  'completed',
  'completedWithErrors',
  'failed',
  'cancelled',
];

export function isTerminalImportStatus(status: ImportBatchStatus): boolean {
  return TERMINAL_IMPORT_STATUSES.includes(status);
}

/** True while a worker is expected to move the batch on without any user input. */
export function isImportInFlight(status: ImportBatchStatus): boolean {
  return status === 'pending' || status === 'processing' || status === 'committing';
}

export const IMPORT_STATUS_LABELS: Readonly<Record<ImportBatchStatus, string>> = {
  pending: 'Queued',
  processing: 'Processing',
  awaitingMapping: 'Needs review',
  committing: 'Importing',
  completed: 'Completed',
  completedWithErrors: 'Completed with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/* ------------------------------------------------------------------ *
 * Row-level errors
 * ------------------------------------------------------------------ */

/**
 * Stable codes from the worker. They are classified rather than free text so
 * the wording lives here and can change without touching the backend.
 */
export type ImportErrorCode =
  | 'InvalidPhoneNumber'
  | 'MissingRequiredField'
  | 'InvalidEmail'
  | 'DuplicateContact'
  | 'DuplicateInFile'
  | 'UnsupportedColumn'
  | 'InvalidCountry'
  | 'DatabaseError'
  | 'PlanLimitExceeded';

export const IMPORT_ERROR_MESSAGES: Readonly<Record<ImportErrorCode, string>> = {
  InvalidPhoneNumber: 'The phone number is not a valid WhatsApp number.',
  MissingRequiredField: 'A required field was left empty.',
  InvalidEmail: 'The email address is not valid.',
  DuplicateContact: 'A contact with this number already exists.',
  DuplicateInFile: 'This number appears more than once in the file.',
  UnsupportedColumn: 'This column does not map to any contact field.',
  InvalidCountry: 'The country could not be recognised.',
  DatabaseError: 'The row could not be saved. It is safe to retry.',
  PlanLimitExceeded: 'Your plan’s contact limit was reached before this row.',
};

/** Short headings for the per-reason breakdown, where the full sentence is too long. */
export const IMPORT_ERROR_LABELS: Readonly<Record<ImportErrorCode, string>> = {
  InvalidPhoneNumber: 'Invalid phone number',
  MissingRequiredField: 'Missing required field',
  InvalidEmail: 'Invalid email',
  DuplicateContact: 'Already in your contacts',
  DuplicateInFile: 'Duplicated in the file',
  UnsupportedColumn: 'Unsupported column',
  InvalidCountry: 'Unrecognised country',
  DatabaseError: 'Could not be saved',
  PlanLimitExceeded: 'Plan limit reached',
};

/** Falls back to the server's own wording for a code we have not met yet. */
export function importErrorMessage(error: ImportRowError): string {
  return IMPORT_ERROR_MESSAGES[error.code] ?? error.message;
}

export function importErrorLabel(code: ImportErrorCode): string {
  return IMPORT_ERROR_LABELS[code] ?? code;
}

export interface ImportRowError {
  readonly code: ImportErrorCode;
  /** Target field the failure belongs to (e.g. `PhoneNumber`), when attributable. */
  readonly field: string | null;
  /** The server's own wording; used when we do not recognise `code`. */
  readonly message: string;
}

export type ImportRowStatus =
  | 'pending'
  | 'valid'
  | 'imported'
  | 'updated'
  | 'duplicate'
  | 'skipped'
  | 'failed';

export interface ImportRow {
  readonly rowNumber: number;
  readonly status: ImportRowStatus;
  /** Raw cells keyed by source column header. */
  readonly values: Readonly<Record<string, string>>;
  readonly errors: readonly ImportRowError[];
}

/** Aggregated counts per error code, so the detail page needs no row scan. */
export interface ImportErrorGroup {
  readonly code: ImportErrorCode;
  readonly count: number;
}

/* ------------------------------------------------------------------ *
 * Column mapping
 * ------------------------------------------------------------------ */

export type ImportTargetField =
  | 'fullName'
  | 'phoneNumber'
  | 'email'
  | 'country'
  | 'status'
  | 'tags'
  | 'groups';

export interface ImportTargetFieldMeta {
  readonly key: ImportTargetField;
  readonly label: string;
  readonly required: boolean;
  readonly hint: string;
}

/**
 * The phone number is the only field the API insists on: it is what makes a
 * contact reachable and what duplicate detection keys on. Everything else,
 * including the name, is optional there — so it is optional here.
 */
export const IMPORT_TARGET_FIELDS: readonly ImportTargetFieldMeta[] = [
  {
    key: 'phoneNumber',
    label: 'Phone number',
    required: true,
    hint: 'Normalised to E.164 and used to detect duplicates.',
  },
  {
    key: 'fullName',
    label: 'Full name',
    required: false,
    hint: 'Shown everywhere the contact appears. Strongly recommended.',
  },
  { key: 'email', label: 'Email', required: false, hint: 'Optional secondary channel.' },
  { key: 'country', label: 'Country', required: false, hint: 'Name or ISO code.' },
  {
    key: 'status',
    label: 'Status',
    required: false,
    hint: 'Subscribed, Unsubscribed or Blocked. Defaults to Subscribed.',
  },
  { key: 'tags', label: 'Tags', required: false, hint: 'Separate multiple values with a semicolon.' },
  {
    key: 'groups',
    label: 'Groups',
    required: false,
    hint: 'Separate multiple values with a semicolon. Missing ones are created.',
  },
];

/** Target field → source column header. `null` leaves the field unmapped. */
export type ImportFieldMapping = Readonly<Partial<Record<ImportTargetField, string | null>>>;

export function unmappedRequiredFields(mapping: ImportFieldMapping): readonly ImportTargetFieldMeta[] {
  return IMPORT_TARGET_FIELDS.filter(
    (field) => field.required && (mapping[field.key] ?? '') === '',
  );
}

/* ------------------------------------------------------------------ *
 * Batches
 * ------------------------------------------------------------------ */

export interface ImportStatistics {
  readonly totalRows: number;
  readonly successful: number;
  readonly updated: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly skipped: number;
}

export const EMPTY_IMPORT_STATISTICS: ImportStatistics = {
  totalRows: 0,
  successful: 0,
  updated: 0,
  duplicates: 0,
  failed: 0,
  skipped: 0,
};

/** One row of the history table. */
export interface ImportBatchSummary {
  readonly batchId: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly status: ImportBatchStatus;
  readonly statistics: ImportStatistics;
  readonly uploadedAt: string;
  readonly completedAt: string | null;
  readonly uploadedBy: string;
  /** Whether a failed-record workbook can be generated for this batch. */
  readonly hasFailedRecords: boolean;
}

/**
 * How many rows the plan had room for.
 *
 * Present once the worker has counted; `skippedForLimit` is what the ceiling
 * actually cost this import.
 */
export interface ImportPlanLimit {
  readonly contactLimit: number;
  readonly currentContacts: number;
  readonly skippedForLimit: number;
}

export interface ImportBatch extends ImportBatchSummary {
  /** 0–100. The worker reports it; it is not inferred from the counts. */
  readonly progressPercent: number;
  readonly detectedColumns: readonly string[];
  readonly suggestedMapping: ImportFieldMapping;
  /** What was saved by `saveMapping`, or the suggestion until then. */
  readonly mapping: ImportFieldMapping;
  readonly errorGroups: readonly ImportErrorGroup[];
  /** Set when the batch itself failed, as opposed to individual rows. */
  readonly failureReason: string | null;
  readonly planLimit: ImportPlanLimit | null;
}

/**
 * What the hub pushes when a worker moves a batch on.
 *
 * Deliberately narrow: it carries enough to update a card or a table row
 * without a refetch, and nothing that would go stale if it arrived late.
 */
export interface ImportProgressEvent {
  readonly batchId: string;
  readonly status: ImportBatchStatus;
  readonly progressPercent: number;
  readonly statistics: ImportStatistics;
  readonly failureReason: string | null;
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

/**
 * What to do with a number that is already in the audience.
 *
 * Chosen at *upload*, not at commit: the parse classifies duplicates against
 * it, so it is fixed for the life of the batch. Changing your mind means
 * cancelling and uploading again.
 *
 * These are the wire values — the API expects them PascalCase.
 */
export type ImportDuplicateStrategy = 'Skip' | 'Update';

export const DEFAULT_DUPLICATE_STRATEGY: ImportDuplicateStrategy = 'Skip';

export interface ImportDuplicateStrategyMeta {
  readonly value: ImportDuplicateStrategy;
  readonly label: string;
  readonly hint: string;
}

export const IMPORT_DUPLICATE_STRATEGIES: readonly ImportDuplicateStrategyMeta[] = [
  { value: 'Skip', label: 'Keep what I have', hint: 'Leave the existing contact untouched.' },
  { value: 'Update', label: 'Use the file', hint: "Apply the file's values over the existing contact." },
];

/** 202-style response: the file is stored and queued, nothing is imported yet. */
export interface ImportUploadAccepted {
  readonly batchId: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly status: ImportBatchStatus;
  readonly uploadedAt: string;
}

/** Commit is queued, not performed — the response says so and nothing more. */
export interface ImportCommitAccepted {
  readonly batchId: string;
  readonly status: ImportBatchStatus;
  readonly queuedAt: string;
}

/* ------------------------------------------------------------------ *
 * Failed-record export
 * ------------------------------------------------------------------ */

export type ImportExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImportExportJob {
  readonly exportId: string;
  readonly batchId: string;
  readonly status: ImportExportStatus;
  readonly fileName: string | null;
  readonly rowCount: number;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly failureReason: string | null;
}

export function isTerminalExportStatus(status: ImportExportStatus): boolean {
  return status === 'completed' || status === 'failed';
}

/* ------------------------------------------------------------------ *
 * Upload constraints
 *
 * Mirrored from the API so a hopeless file is rejected before it is sent.
 * The server remains the authority.
 * ------------------------------------------------------------------ */

export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_IMPORT_EXTENSIONS: readonly string[] = ['.csv', '.xlsx'];
export const ACCEPTED_IMPORT_ACCEPT_ATTR =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function describeFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side gate. Returns the reason a file cannot be sent, or `null`. */
export function rejectionReason(file: File): string | null {
  const name = file.name.toLowerCase();
  const allowed = ACCEPTED_IMPORT_EXTENSIONS.some((extension) => name.endsWith(extension));

  if (!allowed) {
    return `${file.name} is not a CSV or XLSX file.`;
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return `${file.name} is ${describeFileSize(file.size)}. The limit is ${describeFileSize(MAX_IMPORT_FILE_BYTES)}.`;
  }
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }
  return null;
}
