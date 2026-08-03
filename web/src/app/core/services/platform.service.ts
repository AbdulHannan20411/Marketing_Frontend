import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import type { AuditLogEntry, SystemSnapshot, Tenant } from '@core/models/platform.model';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly api = inject(ApiService);

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
