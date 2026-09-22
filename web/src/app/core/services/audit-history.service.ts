import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import {
  toAuditEntry,
  type AuditEntry,
  type AuditHistoryQuery,
} from '@core/models/audit-history.model';
import { ApiService, type QueryParams } from './api.service';

/**
 * One record's history, from one endpoint, for every kind of record:
 * `GET /audit/{entityName}/{entityId}`.
 *
 * The entity name is part of the path rather than a query parameter because the
 * API authorises on it — it decides whether this user may read that record's
 * history at all, and a name it does not recognise is a 404, not an empty list.
 */
@Injectable({ providedIn: 'root' })
export class AuditHistoryService {
  private readonly api = inject(ApiService);

  history(
    entityName: string,
    entityId: string,
    query: AuditHistoryQuery,
  ): Observable<PagedResult<AuditEntry>> {
    return this.api
      .get<PagedResult<Record<string, unknown>>>(
        `/audit/${encodeURIComponent(entityName)}/${encodeURIComponent(entityId)}`,
        toParams(query),
      )
      .pipe(map((page) => ({ ...page, items: page.items.map(toAuditEntry) })));
  }
}

/**
 * Only the filters that are actually set.
 *
 * An empty value must be **left out**, not sent empty: `HttpParams.set` keeps
 * an empty string, so `?action=&from=` reached the API, where an empty enum and
 * an empty date are a bad request — every unfiltered history read failed, which
 * on screen looked like a record with no history.
 */
function toParams(query: AuditHistoryQuery): QueryParams {
  const params: Record<string, string | number> = {
    page: query.page,
    pageSize: query.pageSize,
  };
  if (query.action !== undefined && query.action !== 'all') {
    params['action'] = query.action;
  }
  if (query.userId) {
    params['userId'] = query.userId;
  }
  if (query.from) {
    params['from'] = query.from;
  }
  if (query.to) {
    params['to'] = query.to;
  }
  return params;
}
