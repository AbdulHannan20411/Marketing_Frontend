/**
 * Asynchronous list-view exports.
 *
 * The client never waits for a file. It posts the list view's current state,
 * gets a job id back straight away, and hears about the rest over SignalR —
 * so a million-row export costs the same request as a ten-row one.
 */

/** Where an export has got to. Mirrors the API's own enum. */
export type ExportJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

/** What the file is written as. */
export type ExportFormat = 'csv' | 'xlsx';

/**
 * Statuses from which nothing further happens on its own.
 *
 * Used to decide when to stop watching a job — a cancelled or expired export
 * will not move again, and polling one is a request per tick for no reason.
 */
const TERMINAL: readonly ExportJobStatus[] = ['completed', 'failed', 'cancelled', 'expired'];

/** Whether an export has finished moving, either way. */
export function isTerminalExportStatus(status: ExportJobStatus): boolean {
  return TERMINAL.includes(status);
}

/** One column a list view can export. */
export interface ExportColumn {
  readonly key: string;
  readonly heading: string;
  /** On when the user picks nothing. */
  readonly default: boolean;
}

/** A list view that can be exported, as the dialog renders it. */
export interface ExportDataset {
  readonly key: string;
  readonly name: string;
  readonly columns: readonly ExportColumn[];
}

/** An export job, as the history and the toasts render it. */
export interface ExportJob {
  readonly id: string;
  readonly dataset: string;
  readonly datasetName: string;
  readonly format: ExportFormat;
  readonly status: ExportJobStatus;
  readonly totalRecords: number | null;
  readonly processedRecords: number;
  /** Null means indeterminate — show a spinner, not a bar stuck at zero. */
  readonly percentage: number | null;
  readonly fileName: string | null;
  readonly fileSizeBytes: number | null;
  /** A sentence the user can act on. Never technical detail. */
  readonly errorMessage: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly expiresAt: string | null;
  /**
   * Whether a download would succeed right now.
   *
   * Computed server-side, so the client does not have to combine status, file
   * presence and expiry itself and cannot get that combination wrong.
   */
  readonly isDownloadable: boolean;
}

/**
 * What the client sends when Export is clicked.
 *
 * This is the list view's own state. There is no page and no row count: the
 * export is "everything matching what I am looking at", and the server works
 * out how much that is.
 */
export interface CreateExportRequest {
  readonly dataset: string;
  readonly format: ExportFormat;
  readonly search?: string | null;
  /** The view's filters by name. Unknown names are ignored by the API. */
  readonly filters?: Readonly<Record<string, string>>;
  readonly sortBy?: string | null;
  readonly sortDirection?: 'asc' | 'desc' | null;
  /** Column keys, in order. Omit for the dataset's defaults. */
  readonly columns?: readonly string[];
}

/** What the API answers as soon as the export is accepted. */
export interface ExportAccepted {
  readonly jobId: string;
  readonly status: ExportJobStatus;
  /**
   * True when an identical export was already running.
   *
   * The client says "that export is already running" rather than implying a
   * second file is coming.
   */
  readonly reused: boolean;
}

/** The SignalR payload. One event carries the whole lifecycle. */
export interface ExportProgressEvent {
  readonly jobId: string;
  readonly dataset: string;
  readonly datasetName: string;
  readonly status: ExportJobStatus;
  readonly processedRecords: number;
  readonly totalRecords: number | null;
  readonly percentage: number | null;
  readonly fileName: string | null;
  readonly errorMessage: string | null;
}
