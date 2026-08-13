import type {
  ImportDetailsDto,
  ImportErrorGroupDto,
  ImportExportResponseDto,
  ImportFieldMappingDto,
  ImportListItemDto,
  ImportRowDto,
  ImportStatisticsDto,
  ImportBatchStatusDto,
  ImportRowStatusDto,
} from '@core/dto/contact-import.dto';

/**
 * In-memory stand-in for the import pipeline.
 *
 * There is no worker here, so status is *derived* from how long ago the batch
 * was uploaded or committed. That keeps the mock stateless between requests —
 * no timers, no drift when a tab is throttled — while still exercising the
 * polling and push paths in the UI exactly as a real queue would.
 */

const PARSE_QUEUE_MS = 2_000;
const PARSE_MS = 7_000;
const COMMIT_MS = 8_000;
const EXPORT_MS = 3_000;

/** Matches the headers the real template ships with. */
export const MOCK_IMPORT_COLUMNS: readonly string[] = [
  'Full Name',
  'Phone Number',
  'Email',
  'Country',
  'Status',
  'Tags',
  'Groups',
];

interface MockRow {
  readonly rowNumber: number;
  readonly values: Record<string, string>;
  /** Empty when the row is clean. */
  readonly errors: readonly { code: string; field: string | null; message: string }[];
}

export interface MockImportBatch {
  readonly batchId: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly uploadedAt: number;
  readonly uploadedBy: string;
  readonly rows: readonly MockRow[];
  /** Fixed at upload, as the API fixes it. `Skip` or `Update`. */
  readonly duplicateStrategy: string;
  mapping: ImportFieldMappingDto | null;
  committedAt: number | null;
  cancelled: boolean;
}

const FIRST_NAMES = [
  'Amara', 'Bilal', 'Chen', 'Dara', 'Elif', 'Farid', 'Gita', 'Hassan',
  'Ines', 'Jonas', 'Kiran', 'Lena', 'Marco', 'Nadia', 'Omar', 'Priya',
];
const LAST_NAMES = [
  'Okafor', 'Rahman', 'Wei', 'Silva', 'Yilmaz', 'Haddad', 'Nair', 'Karim',
  'Costa', 'Berg', 'Shah', 'Novak', 'Rossi', 'Aziz', 'Farouk', 'Menon',
];
const COUNTRIES = ['GB', 'PK', 'AE', 'US', 'DE', 'Narnia'];

/** Deterministic pseudo-random, so a given batch id always tells the same story. */
function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return value / 4_294_967_296;
  };
}

function buildRows(seed: number, count: number): readonly MockRow[] {
  const random = seeded(seed);
  const rows: MockRow[] = [];
  const seenNumbers = new Set<string>();

  for (let index = 0; index < count; index++) {
    const first = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
    const country = COUNTRIES[Math.floor(random() * COUNTRIES.length)];
    const roll = random();

    // A realistic spread: mostly clean, with each failure class represented.
    const number =
      roll < 0.06 ? '07xx not a number' : `+44 7${String(700_000_000 + Math.floor(random() * 8_999_999)).slice(0, 9)}`;
    const email = roll > 0.9 ? `${first.toLowerCase()}@@broken` : `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;

    const errors: { code: string; field: string | null; message: string }[] = [];
    if (roll < 0.06) {
      errors.push({
        code: 'InvalidPhoneNumber',
        field: 'PhoneNumber',
        message: 'The phone number is missing or could not be read.',
      });
    }
    if (roll > 0.9) {
      errors.push({ code: 'InvalidEmail', field: 'Email', message: 'Malformed address.' });
    }
    if (country === 'Narnia') {
      errors.push({ code: 'InvalidCountry', field: 'Country', message: 'Unknown country.' });
    }
    if (seenNumbers.has(number)) {
      errors.push({
        code: 'DuplicateInFile',
        field: 'PhoneNumber',
        message: 'Appears earlier in this file.',
      });
    }
    seenNumbers.add(number);

    rows.push({
      rowNumber: index + 2, // row 1 is the header
      values: {
        'Full Name': `${first} ${last}`,
        'Phone Number': number,
        Email: email,
        Country: country,
        Status: 'Subscribed',
        Tags: roll > 0.5 ? 'vip;newsletter' : 'newsletter',
        Groups: 'Customers',
      },
      errors,
    });
  }

  return rows;
}

export const importStore: MockImportBatch[] = [];
const exportStore = new Map<string, { batchId: string; requestedAt: number; rowCount: number }>();

/** Seeds a finished batch so the history table is not empty on first load. */
function seedHistory(): void {
  if (importStore.length > 0) {
    return;
  }
  const hourAgo = Date.now() - 3_600_000;
  importStore.push({
    batchId: 'imp_seed_1',
    fileName: 'contacts-march.xlsx',
    fileSizeBytes: 412_000,
    uploadedAt: hourAgo,
    uploadedBy: 'Ayesha Khan',
    rows: buildRows(11, 120),
    duplicateStrategy: 'Skip',
    mapping: SUGGESTED_MAPPING,
    committedAt: hourAgo + 30_000,
    cancelled: false,
  });
}

export function createMockBatch(
  fileName: string,
  fileSizeBytes: number,
  duplicateStrategy: string,
): MockImportBatch {
  seedHistory();

  const batch: MockImportBatch = {
    batchId: `imp_${crypto.randomUUID().slice(0, 8)}`,
    fileName,
    fileSizeBytes,
    uploadedAt: Date.now(),
    uploadedBy: 'You',
    rows: buildRows(fileName.length + fileSizeBytes, 84),
    duplicateStrategy,
    mapping: null,
    committedAt: null,
    cancelled: false,
  };

  importStore.unshift(batch);
  return batch;
}

export function findMockBatch(batchId: string): MockImportBatch | undefined {
  seedHistory();
  return importStore.find((batch) => batch.batchId === batchId);
}

export function allMockBatches(): readonly MockImportBatch[] {
  seedHistory();
  return importStore;
}

/* ------------------------------------------------------------------ *
 * Derived state
 * ------------------------------------------------------------------ */

export function statusOf(batch: MockImportBatch): ImportBatchStatusDto {
  if (batch.cancelled) {
    return 'Cancelled';
  }

  if (batch.committedAt === null) {
    const elapsed = Date.now() - batch.uploadedAt;
    if (elapsed < PARSE_QUEUE_MS) {
      return 'Pending';
    }
    if (elapsed < PARSE_MS) {
      return 'Processing';
    }
    return 'AwaitingMapping';
  }

  if (Date.now() - batch.committedAt < COMMIT_MS) {
    return 'Committing';
  }
  return failedCount(batch) > 0 ? 'CompletedWithErrors' : 'Completed';
}

function isFinished(batch: MockImportBatch): boolean {
  const status = statusOf(batch);
  return status === 'Completed' || status === 'CompletedWithErrors';
}

function failedCount(batch: MockImportBatch): number {
  return batch.rows.filter((row) => row.errors.length > 0).length;
}

function duplicateCount(batch: MockImportBatch): number {
  return batch.rows.filter((row) => row.errors.some((error) => error.code === 'DuplicateInFile'))
    .length;
}

export function progressOf(batch: MockImportBatch): number {
  const status = statusOf(batch);
  if (status === 'Pending') {
    return 0;
  }
  if (status === 'Processing') {
    const elapsed = Date.now() - batch.uploadedAt - PARSE_QUEUE_MS;
    return Math.min(95, Math.round((elapsed / (PARSE_MS - PARSE_QUEUE_MS)) * 100));
  }
  if (status === 'Committing' && batch.committedAt !== null) {
    return Math.min(95, Math.round(((Date.now() - batch.committedAt) / COMMIT_MS) * 100));
  }
  return 100;
}

export function statisticsOf(batch: MockImportBatch): ImportStatisticsDto {
  const total = batch.rows.length;

  if (!isFinished(batch)) {
    const parsed = statusOf(batch) === 'Pending' ? 0 : total;
    return {
      totalRows: parsed,
      successful: 0,
      updated: 0,
      duplicates: 0,
      failed: 0,
      skipped: 0,
    };
  }

  const failed = failedCount(batch);
  const duplicates = duplicateCount(batch);
  const clean = total - failed;

  // Under `Update` a duplicate is rewritten; under `Skip` it is left alone.
  // `duplicates` overlaps the other counts deliberately, as the API's does.
  const updated = batch.duplicateStrategy === 'Update' ? duplicates : 0;
  const skipped = batch.duplicateStrategy === 'Update' ? 0 : duplicates;

  return {
    totalRows: total,
    successful: clean - updated - skipped,
    updated,
    duplicates,
    failed,
    skipped,
  };
}

function errorGroupsOf(batch: MockImportBatch): readonly ImportErrorGroupDto[] {
  if (!isFinished(batch)) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const row of batch.rows) {
    for (const error of row.errors) {
      counts.set(error.code, (counts.get(error.code) ?? 0) + 1);
    }
  }
  return [...counts].map(([code, count]) => ({ code, count }));
}

const SUGGESTED_MAPPING: ImportFieldMappingDto = {
  fullName: 'Full Name',
  phoneNumber: 'Phone Number',
  email: 'Email',
  country: 'Country',
  status: 'Status',
  tags: 'Tags',
  groups: 'Groups',
};

export function toListItem(batch: MockImportBatch): ImportListItemDto {
  const status = statusOf(batch);
  return {
    batchId: batch.batchId,
    fileName: batch.fileName,
    fileSizeBytes: batch.fileSizeBytes,
    status,
    statistics: statisticsOf(batch),
    uploadedAt: new Date(batch.uploadedAt).toISOString(),
    completedAt:
      isFinished(batch) && batch.committedAt !== null
        ? new Date(batch.committedAt + COMMIT_MS).toISOString()
        : null,
    uploadedBy: batch.uploadedBy,
    hasFailedRecords: isFinished(batch) && failedCount(batch) > 0,
  };
}

export function toDetails(batch: MockImportBatch): ImportDetailsDto {
  const parsed = statusOf(batch) !== 'Pending' && statusOf(batch) !== 'Processing';
  return {
    ...toListItem(batch),
    progressPercent: progressOf(batch),
    detectedColumns: parsed ? MOCK_IMPORT_COLUMNS : [],
    suggestedMapping: SUGGESTED_MAPPING,
    mapping: batch.mapping,
    errorGroups: errorGroupsOf(batch),
    failureReason: null,
    // Only interesting once a ceiling has actually been hit.
    planLimit: null,
  };
}

function rowStatusOf(batch: MockImportBatch, row: MockRow): ImportRowStatusDto {
  if (row.errors.length > 0) {
    return isFinished(batch) ? 'Failed' : 'Pending';
  }
  if (!isFinished(batch)) {
    return statusOf(batch) === 'AwaitingMapping' ? 'Valid' : 'Pending';
  }
  return 'Imported';
}

/**
 * `filter` arrives in the API's PascalCase. An unrecognised value matches
 * nothing, exactly as the real endpoint does — silently returning everything
 * would let the operator believe a filter had been applied.
 */
export function rowsOf(batch: MockImportBatch, filter: string): readonly ImportRowDto[] {
  const mapped = batch.rows.map((row) => ({
    rowNumber: row.rowNumber,
    status: rowStatusOf(batch, row),
    values: row.values,
    errors: [...row.errors],
  }));

  return filter === 'all' ? mapped : mapped.filter((row) => row.status === filter);
}

/* ------------------------------------------------------------------ *
 * Failed-record export
 * ------------------------------------------------------------------ */

export function startExport(batch: MockImportBatch): ImportExportResponseDto {
  const exportId = `exp_${crypto.randomUUID().slice(0, 8)}`;
  exportStore.set(exportId, {
    batchId: batch.batchId,
    requestedAt: Date.now(),
    rowCount: failedCount(batch),
  });
  return exportStatus(exportId)!;
}

export function exportStatus(exportId: string): ImportExportResponseDto | null {
  const job = exportStore.get(exportId);
  if (job === undefined) {
    return null;
  }

  const ready = Date.now() - job.requestedAt >= EXPORT_MS;
  return {
    exportId,
    batchId: job.batchId,
    status: ready ? 'Completed' : 'Processing',
    fileName: 'contacts-failed-records.csv',
    rowCount: job.rowCount,
    requestedAt: new Date(job.requestedAt).toISOString(),
    completedAt: ready ? new Date(job.requestedAt + EXPORT_MS).toISOString() : null,
    failureReason: null,
  };
}

/** A real API would ship XLSX; CSV keeps the mock free of a spreadsheet library. */
export function exportCsv(exportId: string): string {
  const job = exportStore.get(exportId);
  const batch = job === undefined ? undefined : findMockBatch(job.batchId);
  if (batch === undefined) {
    return 'Row,Error\n';
  }

  // Mirrors the real workbook: the operator's own columns, then Row/Error Code/Error.
  const lines = [`${MOCK_IMPORT_COLUMNS.join(',')},Row,Error Code,Error`];
  for (const row of batch.rows) {
    if (row.errors.length === 0) {
      continue;
    }
    const reason = row.errors.map((error) => error.message).join(' ');
    lines.push(
      [
        ...MOCK_IMPORT_COLUMNS.map((column) => row.values[column] ?? ''),
        row.rowNumber,
        row.errors.map((error) => error.code).join(' '),
        reason,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    );
  }
  return lines.join('\n');
}

export const IMPORT_TEMPLATE_CSV = `${MOCK_IMPORT_COLUMNS.join(',')}
Jane Doe,+14155552671,jane@example.com,US,Subscribed,vip;newsletter,Customers
`;
