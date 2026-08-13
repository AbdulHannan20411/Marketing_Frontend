import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import type { AdminAccount, PlatformOverview } from '@core/models/admin-account.model';
import type {
  AuditLogEntry,
  SystemSnapshot,
  Tenant,
  TenantPlan,
  TenantStatus,
} from '@core/models/platform.model';
import { ApiService } from './api.service';

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

@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly api = inject(ApiService);

  /** Every Admin account on the platform — the Super Admin's entry point. */
  listAdmins(): Observable<readonly AdminAccount[]> {
    return this.api.get<readonly AdminAccount[]>('/superadmin/admins');
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

  listTenants(page: number, pageSize: number): Observable<PagedResult<Tenant>> {
    return this.api.get<PagedResult<Tenant>>('/admin/tenants', { page, pageSize });
  }

  listAuditLogs(page: number, pageSize: number): Observable<PagedResult<AuditLogEntry>> {
    return this.api.get<PagedResult<AuditLogEntry>>('/admin/audit', { page, pageSize });
  }

  getSystemSnapshot(): Observable<SystemSnapshot> {
    return this.api.get<SystemSnapshot>('/admin/system');
  }
}
