import { Injectable, inject } from '@angular/core';
import { map, tap, type Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import type { AdminAccount, PlatformOverview } from '@core/models/admin-account.model';
import type {
  AuditLogEntry,
  SystemSnapshot,
  Tenant,
  TenantPlan,
  TenantStatus,
} from '@core/models/platform.model';
import {
  pagingParams,
  toAdaptivePage,
  type AdaptivePage,
  type ListQuery,
  type ServerListSupport,
} from '@core/http/adaptive-page';
import { comparatorFor } from '@core/services/contacts.service';
import { sortParams, type SortColumn, type SortDirection } from '@shared/ui/data-table/sort';
import { ApiService } from './api.service';
import { saveBlob } from './contacts.service';

/**
 * The whole payload. No password — the owner sets their own through the
 * invitation link — and no plan, because the tenant is created on the default
 * band and the organisation picks its own after signing in.
 */
export interface CreateAdminAccountRequest {
  readonly name: string;
  readonly email: string;
  readonly organisation: string;
}

export interface UpdateAdminAccountRequest {
  readonly name?: string;
  readonly organisation?: string;
  readonly plan?: TenantPlan;
}

/*
 * What `/superadmin/admins` does for itself.
 *
 * It searches — `WhereMatchesAdminSearch` — and filters by status, both
 * alongside the paging. It does not sort: the query ends `OrderBy(displayName)`
 * whatever `sortBy` says, so a sorted request has to be answered here.
 */
const ADMINS_SERVER_SUPPORT: ServerListSupport = { search: true, sort: false };

/** What the admin-account list can be ordered by. */
export const ADMIN_SORT_COLUMNS: readonly SortColumn<AdminAccount>[] = [
  { key: 'id', label: 'ID', kind: 'text', value: (admin) => admin.id },
  { key: 'organisation', label: 'Organisation', kind: 'text', value: (admin) => admin.organisation },
  { key: 'name', label: 'Admin', kind: 'text', value: (admin) => admin.name },
  { key: 'plan', label: 'Plan', kind: 'text', value: (admin) => admin.plan },
  { key: 'status', label: 'Status', kind: 'text', value: (admin) => admin.status },
  {
    key: 'messagesThisMonth',
    label: 'Messages',
    kind: 'number',
    value: (admin) => admin.messagesThisMonth,
    initialDirection: 'desc',
  },
  {
    key: 'employeeCount',
    label: 'Staff',
    kind: 'number',
    value: (admin) => admin.employeeCount,
    initialDirection: 'desc',
  },
  {
    key: 'contactCount',
    label: 'Contacts',
    kind: 'number',
    value: (admin) => admin.contactCount,
    initialDirection: 'desc',
  },
  {
    key: 'createdAt',
    label: 'Created',
    kind: 'date',
    value: (admin) => admin.createdAt,
    initialDirection: 'desc',
  },
  {
    key: 'lastActiveAt',
    label: 'Last active',
    kind: 'date',
    value: (admin) => admin.lastActiveAt,
    initialDirection: 'desc',
  },
];

/** What the audit screen can narrow by. Every field optional. */
export interface AuditLogFilters {
  /** Free text over the actor, the action and the record. */
  readonly search?: string;
  /** Exact actor name, as the entries report it. */
  readonly actor?: string | null;
  /** `critical` | `warning` | `info`, or null for every severity. */
  readonly severity?: string | null;
  /** Inclusive ISO instants. */
  readonly from?: string | null;
  readonly to?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly api = inject(ApiService);

  /** Every Admin account on the platform — the Super Admin's entry point. */
  /**
   * Every admin account.
   *
   * Still here because two callers need the whole set: the platform search,
   * which matches across all of them, and the security index, which fetches a
   * summary per workspace. The **list screen** uses {@link pageAdmins}.
   */
  listAdmins(): Observable<readonly AdminAccount[]> {
    return this.api.get<readonly AdminAccount[]>('/superadmin/admins');
  }

  /**
   * One page of admin accounts, searched and ordered by the API.
   *
   * Adapts whatever comes back: a `PagedResult` is passed through, a bare
   * array is filtered, ordered and sliced here. The screen reads the same
   * either way, so when `/superadmin/admins` starts paging there is nothing
   * to change — see `docs/API-LIST-PAGINATION-BACKEND.md`.
   */
  pageAdmins(
    query: ListQuery & { readonly status?: string },
  ): Observable<AdaptivePage<AdminAccount>> {
    return this.api
      .get<PagedResult<AdminAccount> | readonly AdminAccount[]>('/superadmin/admins', {
        ...pagingParams(query, ADMINS_SERVER_SUPPORT),
        /*
         * Both omitted rather than sent empty.
         *
         * `status` binds to a nullable `TenantAccountStatus` on the API, where
         * **absent means every state** — there is no `all` member, so sending
         * the screen's own word for it was a 400: "The value 'all' is not
         * valid for Status."
         */
        ...(query.search?.trim() ? { search: query.search.trim() } : {}),
        ...(query.status !== undefined && query.status !== 'all'
          ? { status: query.status }
          : {}),
        ...sortParams(query.sortBy, query.sortDirection),
      })
      .pipe(
        map((response) =>
          toAdaptivePage(response, query, {
            // The status filter is the screen's, so a client-side page has to
            // apply it here as well — before the slice, or the count would
            // describe rows that were then removed.
            matches: (admin, term) =>
              (query.status === undefined ||
                query.status === 'all' ||
                admin.status === query.status) &&
              (term === '' ||
                admin.organisation.toLowerCase().includes(term) ||
                admin.name.toLowerCase().includes(term) ||
                admin.email.toLowerCase().includes(term)),
            compare: (current) => comparatorFor(ADMIN_SORT_COLUMNS, current),
          }),
        ),
      );
  }

  /** Aggregated figures across all Admins. */
  getOverview(): Observable<PlatformOverview> {
    return this.api.get<PlatformOverview>('/superadmin/overview');
  }

  /** Creates the organisation and its first Admin, and sends an invitation. */
  createAdmin(request: CreateAdminAccountRequest): Observable<AdminAccount> {
    return this.api.post<AdminAccount, CreateAdminAccountRequest>('/superadmin/admins', request);
  }

  updateAdmin(id: string, changes: UpdateAdminAccountRequest): Observable<AdminAccount> {
    return this.api.put<AdminAccount, UpdateAdminAccountRequest>(
      `/superadmin/admins/${id}`,
      changes,
    );
  }

  updateAdminStatus(id: string, status: TenantStatus): Observable<AdminAccount> {
    return this.api.put<AdminAccount>(`/superadmin/admins/${id}/status`, { status });
  }

  removeAdmin(id: string): Observable<null> {
    return this.api.delete(`/superadmin/admins/${id}`);
  }

  /**
   * A page of workspaces.
   *
   * `search` is sent and, today, dropped: `PageRequest` carries it and
   * `PlatformService.GetTenantsAsync` never reads it. Unlike `/groups` this
   * endpoint has no unpaged form to fall back to, so there is nothing the
   * client can do about it — see `docs/API-LIST-PAGINATION-BACKEND.md` §9.
   * Sorting, by contrast, is applied by the API.
   */
  listTenants(
    page: number,
    pageSize: number,
    sortBy: string | null = null,
    sortDirection: SortDirection = 'asc',
    search = '',
  ): Observable<PagedResult<Tenant>> {
    return this.api.get<PagedResult<Tenant>>('/admin/tenants', {
      page,
      pageSize,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...sortParams(sortBy, sortDirection),
    });
  }

  /**
   * Downloads the audit log the filters select, as one request.
   *
   * The client used to build this file itself, paging the list endpoint a
   * hundred rows at a time and giving up at five thousand — sixty-eight
   * requests for a sixty-eight page log. The API streams it now, with the same
   * filters and the same sort, so the file matches the screen.
   */
  exportAuditLogs(
    sortBy: string | null,
    sortDirection: SortDirection,
    filters: AuditLogFilters = {},
  ): Observable<Blob> {
    return this.api
      .download('/admin/audit/export', {
        ...(filters.search?.trim() ? { search: filters.search.trim() } : {}),
        ...(filters.actor ? { actor: filters.actor } : {}),
        ...(filters.severity ? { severity: filters.severity } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...sortParams(sortBy, sortDirection),
      })
      .pipe(tap((blob) => saveBlob(blob, 'audit-log.csv')));
  }

  /**
   * A page of audit entries.
   *
   * `search`, `actor`, `from` and `to` are sent and, today, dropped:
   * `PlatformService.GetAuditLogAsync` takes a bare `PageRequest` and applies
   * only paging and sorting. Asked for in
   * `docs/API-AUDIT-LOG-FILTERS-BACKEND.md`; until then the filter bar narrows
   * nothing and says so.
   */
  listAuditLogs(
    page: number,
    pageSize: number,
    sortBy: string | null = null,
    sortDirection: SortDirection = 'asc',
    filters: AuditLogFilters = {},
  ): Observable<PagedResult<AuditLogEntry>> {
    return this.api.get<PagedResult<AuditLogEntry>>('/admin/audit', {
      ...(filters.search?.trim() ? { search: filters.search.trim() } : {}),
      ...(filters.actor ? { actor: filters.actor } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      page,
      pageSize,
      ...sortParams(sortBy, sortDirection),
    });
  }

  getSystemSnapshot(): Observable<SystemSnapshot> {
    return this.api.get<SystemSnapshot>('/admin/system');
  }
}
