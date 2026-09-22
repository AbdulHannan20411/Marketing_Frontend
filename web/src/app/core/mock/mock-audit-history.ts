import type { HttpEvent } from '@angular/common/http';
import type { Observable } from 'rxjs';

interface MockHelpers {
  readonly ok: (data: unknown, message?: string | null) => Observable<HttpEvent<unknown>>;
  readonly fail: (status: number, title: string, detail: string, errorCode?: string) => Observable<never>;
}

/**
 * Record history for the in-memory API: `GET /audit/{entityName}/{entityId}`.
 *
 * Seeded per record from its id, so the same record always has the same story
 * and the screen can be judged against something stable. Deliberately mirrors
 * the real contract — only changed fields, a redacted field, a change made by
 * no person — because those are the cases the UI has to get right.
 */

interface MockChange {
  readonly property: string;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
  readonly redacted?: boolean;
}

interface MockAuditEntry {
  readonly id: string;
  readonly entityName: string;
  readonly entityId: string;
  readonly action: 'created' | 'updated' | 'deleted';
  readonly userId: string | null;
  readonly userName: string | null;
  readonly occurredAt: string;
  readonly changes: readonly MockChange[];
}

const HOUR = 3_600_000;

function hash(value: string): number {
  let result = 0;
  for (const char of value) {
    result = (result * 31 + char.charCodeAt(0)) % 100_000;
  }
  return result;
}

function storyFor(entityName: string, entityId: string): readonly MockAuditEntry[] {
  const seed = hash(`${entityName}:${entityId}`);
  const created = Date.now() - (seed % 40) * 24 * HOUR - 6 * HOUR;
  const entry = (
    index: number,
    action: MockAuditEntry['action'],
    who: { id: string | null; name: string | null },
    hoursAfter: number,
    changes: readonly MockChange[],
  ): MockAuditEntry => ({
    id: `aud_${seed}_${index}`,
    entityName,
    entityId,
    action,
    userId: who.id,
    userName: who.name,
    occurredAt: new Date(created + hoursAfter * HOUR).toISOString(),
    changes,
  });

  const admin = { id: 'usr_admin', name: 'Ayesha Khan' };
  const employee = { id: 'usr_employee', name: 'John Rivera' };
  const system = { id: null, name: null };

  const story: MockAuditEntry[] = [
    // A create carries every field that was set — there is no "before".
    entry(1, 'created', admin, 0, [
      { property: 'Name', newValue: 'order_shipped_update' },
      { property: 'Category', newValue: 'Utility' },
      { property: 'Language', newValue: 'en_US' },
      { property: 'Status', newValue: 'Draft' },
      { property: 'BodyText', newValue: 'Hi {{1}}, your order has shipped.' },
    ]),
    // An update carries only what moved: 3 fields out of ~20.
    entry(2, 'updated', employee, 25, [
      { property: 'Name', oldValue: 'order_shipped_update', newValue: 'order_shipped_v2' },
      { property: 'Status', oldValue: 'Draft', newValue: 'Pending' },
      {
        property: 'BodyText',
        oldValue: 'Hi {{1}}, your order has shipped.',
        newValue: 'Hi {{1}}, your order {{2}} has shipped and arrives by {{3}}.',
      },
    ]),
  ];

  if (seed % 2 === 0) {
    story.push(
      entry(3, 'updated', system, 26, [
        { property: 'Status', oldValue: 'Pending', newValue: 'Approved' },
        { property: 'ApprovedOn', oldValue: null, newValue: new Date(created + 26 * HOUR).toISOString() },
      ]),
    );
  }

  if (seed % 3 === 0) {
    story.push(
      entry(4, 'updated', admin, 40, [
        { property: 'FooterText', oldValue: null, newValue: 'Reply STOP to opt out' },
        // Recorded as changed, never as a value.
        { property: 'HtmlBody', redacted: true },
      ]),
    );
  }

  // Newest first, as the API returns them.
  return [...story].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}

/** Records with no history at all, so the empty state is reachable. */
function hasHistory(entityId: string): boolean {
  return hash(entityId) % 7 !== 0;
}

/** Both `HttpParams` and `URLSearchParams` satisfy this. */
interface QueryReader {
  get(name: string): string | null;
}

export function handleAuditHistory(
  path: string,
  method: string,
  params: QueryReader,
  { ok, fail }: MockHelpers,
): Observable<HttpEvent<unknown>> | null {
  const match = /^\/audit\/([^/]+)\/([^/]+)$/.exec(path);
  if (method !== 'GET' || match === null) {
    return null;
  }

  const entityName = decodeURIComponent(match[1]);
  const entityId = decodeURIComponent(match[2]);

  // The real API refuses a name it does not know rather than returning nothing,
  // so a typo in a template is loud instead of looking like "no history".
  const known = ['Template', 'Employee', 'Contact', 'Campaign', 'Group', 'Tag', 'WhatsAppAccount'];
  if (!known.includes(entityName)) {
    return fail(404, 'Unknown record type', `There is no history for "${entityName}".`, 'audit_entity_unknown');
  }

  const all = hasHistory(entityId) ? storyFor(entityName, entityId) : [];

  const action = params.get('action');
  const userId = params.get('userId');
  const from = params.get('from');
  const to = params.get('to');

  const filtered = all.filter((entry) => {
    if (action !== null && action !== '' && entry.action !== action) {
      return false;
    }
    if (userId !== null && userId !== '' && entry.userId !== userId) {
      return false;
    }
    if (from !== null && from !== '' && entry.occurredAt < from) {
      return false;
    }
    // Inclusive of the whole day, as a date filter reads to a person.
    if (to !== null && to !== '' && entry.occurredAt > `${to}T23:59:59.999Z`) {
      return false;
    }
    return true;
  });

  const page = Math.max(1, Number(params.get('page') ?? 1));
  const pageSize = Math.max(1, Number(params.get('pageSize') ?? 10));
  const start = (page - 1) * pageSize;

  return ok({
    items: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    totalItems: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  });
}
