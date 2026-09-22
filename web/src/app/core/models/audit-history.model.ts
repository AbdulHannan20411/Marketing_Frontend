/**
 * Record history: who changed a thing, when, and which fields moved.
 *
 * One shape for every entity. A screen names what it is showing — `Template`,
 * `Employee` — and everything else, including which fields exist and how they
 * read, comes from the server. So enabling history for a new entity is a
 * `<app-history-button entityName="…">`, never a new model here.
 *
 * **Only changed fields are carried.** An update to 5 of 30 properties has 5
 * entries in `changes`; a create has one per field that was set.
 */

/**
 * Record types the API has history for, mirroring the backend's own registry
 * (`AuditableEntities.cs`).
 *
 * The button hides itself for a name that is not here, so a page can carry
 * `<app-history-button entityName="Plan" …>` before the API knows that name and
 * show nothing rather than a button that answers "not available". Add the name
 * here the day the backend adds its registry line — that is the whole change.
 */
export const AUDIT_ENTITIES: readonly string[] = [
  'Template',
  'Employee',
  'Contact',
  'Campaign',
  'Group',
  'Tag',
  // The API resolves these two from `current`: a workspace has exactly one of
  // each, so a public id for them would tell nobody anything.
  'AutoReplySettings',
  'Workspace',
  'WhatsAppAccount',
  // Addressed by key (`invitation`, `password_reset`), as the rest of the API
  // addresses them.
  'EmailTemplate',
  'Plan',
];

export function hasAuditHistory(entityName: string): boolean {
  return AUDIT_ENTITIES.some((name) => name.toLowerCase() === entityName.toLowerCase());
}

export const AUDIT_ACTIONS = ['created', 'updated', 'deleted'] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditChange {
  /** The property as the API names it, e.g. `BodyText`. */
  readonly property: string;
  /** Human wording for the property. Derived from `property` when the API sends none. */
  readonly label: string;
  /** `null` on a create: there was nothing before. */
  readonly oldValue: string | null;
  readonly newValue: string | null;
  /**
   * The field changed but its values are deliberately not recorded — a password
   * hash, a token, an email body. Shown as "changed", never as a value.
   */
  readonly redacted: boolean;
}

export interface AuditEntry {
  readonly id: string;
  readonly entityName: string;
  readonly entityId: string;
  readonly action: AuditAction;
  /** `null` for a change made by a background job rather than a person. */
  readonly userName: string | null;
  readonly userId: string | null;
  /** UTC, as the API records it. */
  readonly occurredAt: string;
  readonly changes: readonly AuditChange[];
}

export interface AuditHistoryQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly action?: AuditAction | 'all';
  /** Matches the user who made the change. */
  readonly userId?: string | null;
  /** Inclusive, as `yyyy-mm-dd` in the viewer's own zone. */
  readonly from?: string | null;
  readonly to?: string | null;
}

export const AUDIT_ACTION_COPY: Readonly<
  Record<AuditAction, { readonly label: string; readonly icon: string; readonly tone: string }>
> = {
  created: { label: 'Created', icon: 'plus', tone: 'bg-green-50 text-green-700 ring-green-200' },
  updated: { label: 'Updated', icon: 'pencil', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  deleted: { label: 'Deleted', icon: 'trash', tone: 'bg-red-50 text-red-700 ring-red-200' },
};

/* ------------------------------------------------------------------ *
 * Normalising what the server sends
 * ------------------------------------------------------------------ */

/**
 * `PascalCase` or `snake_case` property names as a person would read them:
 * `BodyText` → "Body text", `whatsapp_account_id` → "Whatsapp account".
 *
 * The API may send its own `label`, which always wins — this is the fallback so
 * a new field is readable the day it exists, without waiting for wording.
 */
export function humaniseProperty(property: string): string {
  const words = property
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (words === '') {
    return property;
  }
  // A trailing "Id" reads as noise: "Assigned to id" → "Assigned to".
  const trimmed = words.replace(/\s+id$/i, '');
  const first = trimmed.charAt(0).toUpperCase();
  return first + trimmed.slice(1).toLowerCase();
}

/** `true` → "Yes", an ISO instant → a readable date, an object → JSON. */
export function formatAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    // An instant, not a date the user typed: only convert what is clearly one.
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString();
      }
    }
    return trimmed;
  }
  return JSON.stringify(value);
}

/**
 * Columns that carry no information for a reader.
 *
 * Every audited row records who touched it and when, so a change set repeats
 * them as fields — "Modified by: empty → 16", "Modified on: empty → 14 Aug".
 * The entry's own heading already says "Updated by Honey, 14-Aug-2026 04:40 PM",
 * and the raw user id says less than the name beside it. The tenant, the
 * concurrency token and the soft-delete flag are plumbing in the same way: the
 * flag's meaning is the entry's own "Deleted" heading.
 */
const HIDDEN_PROPERTIES = new Set(
  [
    'CreatedBy',
    'CreatedOn',
    'CreatedAt',
    'ModifiedBy',
    'ModifiedOn',
    'ModifiedAt',
    'UpdatedBy',
    'UpdatedOn',
    'UpdatedAt',
    'DeletedBy',
    'DeletedOn',
    'DeletedAt',
    'IsDeleted',
    'RowVersion',
    'TenantId',
  ].map((name) => name.toLowerCase()),
);

/** False for a bookkeeping column — see {@link HIDDEN_PROPERTIES}. */
export function isReadableProperty(property: string): boolean {
  return !HIDDEN_PROPERTIES.has(property.replace(/[_\s]/g, '').toLowerCase());
}

interface RawChange {
  readonly property?: unknown;
  readonly label?: unknown;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
  readonly old?: unknown;
  readonly new?: unknown;
  readonly redacted?: unknown;
}

function toChange(property: string, raw: RawChange | unknown): AuditChange {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as RawChange;
  const redacted = source.redacted === true;
  return {
    property,
    label: typeof source.label === 'string' && source.label !== '' ? source.label : humaniseProperty(property),
    oldValue: redacted ? null : formatAuditValue(source.oldValue ?? source.old ?? null),
    newValue: redacted ? null : formatAuditValue(source.newValue ?? source.new ?? null),
    redacted,
  };
}

/**
 * Reads `changes` in either shape the API might send.
 *
 * The audit table stores a map — `{ "Name": { "old": …, "new": … } }` — while
 * an endpoint may project it to a list of `{ property, oldValue, newValue }`.
 * Both arrive here as the same list, so neither side has to change first.
 */
export function toAuditChanges(raw: unknown): readonly AuditChange[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        const source = (typeof entry === 'object' && entry !== null ? entry : {}) as RawChange;
        const property = typeof source.property === 'string' ? source.property : '';
        return property === '' || !isReadableProperty(property) ? null : toChange(property, source);
      })
      .filter((change): change is AuditChange => change !== null);
  }
  if (typeof raw === 'string') {
    // Some endpoints hand the JSON column back as a string.
    try {
      return raw.trim() === '' ? [] : toAuditChanges(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([property]) => isReadableProperty(property))
      .map(([property, value]) => toChange(property, value));
  }
  return [];
}

function toAction(value: unknown): AuditAction {
  const text = String(value ?? '').toLowerCase();
  return (AUDIT_ACTIONS as readonly string[]).includes(text) ? (text as AuditAction) : 'updated';
}

/** The single seam between the wire and the UI. */
export function toAuditEntry(raw: Record<string, unknown>): AuditEntry {
  const userName = raw['userName'];
  const userId = raw['userId'];
  return {
    id: String(raw['id'] ?? ''),
    entityName: String(raw['entityName'] ?? ''),
    entityId: String(raw['entityId'] ?? ''),
    action: toAction(raw['action']),
    userName: typeof userName === 'string' && userName.trim() !== '' ? userName : null,
    userId: userId === null || userId === undefined ? null : String(userId),
    occurredAt: String(raw['occurredAt'] ?? raw['timestamp'] ?? raw['occurredOn'] ?? ''),
    changes: toAuditChanges(raw['changes']),
  };
}

/** "Ayesha Khan", or an honest stand-in for a change no person made. */
export function auditActorName(entry: AuditEntry): string {
  return entry.userName ?? 'Automatic';
}
