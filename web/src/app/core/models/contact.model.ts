export type ContactStatus = 'subscribed' | 'unsubscribed' | 'blocked';
export type ContactLifecycle = 'lead' | 'customer';

export interface Contact {
  readonly id: string;
  readonly fullName: string;
  readonly initials: string;
  /** E.164, may carry display spacing. */
  readonly phoneNumber: string;
  readonly email: string | null;
  /** ISO 3166-1 alpha-2 code, e.g. `GB` — not a display name. */
  readonly country: string;
  readonly status: ContactStatus;
  readonly tagIds: readonly string[];
  readonly groupIds: readonly string[];
  readonly optedInAt: string | null;
  readonly lastMessagedAt: string | null;
  readonly createdAt: string;
}

export interface ContactGroup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly contactCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TagColor = 'brand' | 'info' | 'warning' | 'danger' | 'neutral';

export interface ContactTag {
  readonly id: string;
  readonly name: string;
  readonly color: TagColor;
  readonly contactCount: number;
  readonly createdAt: string;
}

/** Filters send the literal `all` when cleared — the API treats it as "no filter". */
export interface ContactQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ContactStatus | 'all';
  readonly groupId: string | 'all';
  readonly tagId: string | 'all';
}

/* ------------------------------------------------------------------ *
 * Write payloads
 * ------------------------------------------------------------------ */
export interface CreateContactRequest {
  readonly fullName: string;
  readonly phoneNumber: string;
  readonly email?: string | null;
  /** ISO alpha-2. Sending a display name is rejected. */
  readonly country?: string | null;
  readonly status?: ContactStatus;
  readonly tagIds?: readonly string[];
  readonly groupIds?: readonly string[];
}

/** Patch semantics — but supplying `tagIds`/`groupIds` replaces the whole set. */
export type UpdateContactRequest = Partial<CreateContactRequest> & {
  readonly lifecycle?: ContactLifecycle | null;
};

export type BulkMode = 'add' | 'remove' | 'replace';

export interface BulkContactRequest {
  readonly ids: readonly string[];
}

export interface BulkTagRequest extends BulkContactRequest {
  readonly tagIds: readonly string[];
  readonly mode?: BulkMode;
}

export interface BulkGroupRequest extends BulkContactRequest {
  readonly groupIds: readonly string[];
  readonly mode?: BulkMode;
}

export type DuplicateStrategy = 'phone' | 'email' | 'name';

export interface DuplicateGroup {
  readonly matchValue: string;
  readonly strategy: DuplicateStrategy;
  readonly contacts: readonly Contact[];
}

export interface MergeContactsRequest {
  readonly keepId: string;
  readonly mergeIds: readonly string[];
  readonly fieldOverrides?: Readonly<Record<string, string | null>>;
}

export interface ContactGroupDraft {
  readonly name: string;
  readonly description: string;
}

export interface ContactTagDraft {
  readonly name: string;
  readonly color: TagColor;
}

export interface MembershipRequest {
  readonly contactIds: readonly string[];
}

/* ------------------------------------------------------------------ *
 * CSV import
 * ------------------------------------------------------------------ */
export interface ImportColumnMapping {
  readonly fullName?: string | null;
  readonly phoneNumber?: string | null;
  readonly email?: string | null;
  readonly country?: string | null;
  readonly status?: string | null;
  readonly tags?: string | null;
  readonly groups?: string | null;
}

export interface ImportRowError {
  readonly rowNumber: number;
  readonly reason: string;
}

export interface ImportPreview {
  readonly uploadId: string;
  readonly fileName: string;
  readonly totalRows: number;
  readonly detectedColumns: readonly string[];
  readonly suggestedMapping: ImportColumnMapping;
  readonly sampleRows: readonly Readonly<Record<string, string>>[];
  readonly duplicatesInFile: number;
  readonly duplicatesExisting: number;
  readonly invalidRows: readonly ImportRowError[];
}

export type DuplicateStrategyOnImport = 'skip' | 'update' | 'create';
export type ImportJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ImportCommitRequest {
  readonly uploadId: string;
  readonly mapping: ImportColumnMapping;
  readonly duplicateStrategy?: DuplicateStrategyOnImport;
  readonly defaultStatus?: ContactStatus;
  readonly assignTagIds?: readonly string[];
  readonly assignGroupIds?: readonly string[];
}

/** Commit runs synchronously and returns `completed` — do not poll. */
export interface ImportResult {
  readonly jobId: string;
  readonly status: ImportJobStatus;
  readonly processedRows: number;
  readonly totalRows: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly errors: readonly ImportRowError[];
  readonly completedAt: string | null;
}
