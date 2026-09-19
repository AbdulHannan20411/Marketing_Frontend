import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  DeviceSession,
  SecurityEmployee,
  SecurityOverview,
  SecurityScope,
  SuspendAccountRequest,
} from '@core/models/session-security.model';
import { ApiService } from './api.service';

/**
 * Devices and sessions, at three levels: the signed-in user's own, a
 * workspace's (for its admins), and any workspace's (for platform staff, with
 * a risk score). One service so the screen that shows them can be one screen.
 */
@Injectable({ providedIn: 'root' })
export class SessionSecurityService {
  private readonly api = inject(ApiService);

  /* ------------------------------ my devices ------------------------------ */

  /** The current device first. */
  mySessions(): Observable<readonly DeviceSession[]> {
    return this.api.get<readonly DeviceSession[]>('/auth/sessions');
  }

  revokeMySession(sessionId: string): Observable<null> {
    return this.api.post<null>(`/auth/sessions/${encodeURIComponent(sessionId)}/revoke`);
  }

  /** 204 means fine; a revoked session answers 401 and the interceptor signs out. */
  heartbeat(): Observable<null> {
    return this.api.post<null>('/auth/heartbeat');
  }

  /* --------------------------- workspace / platform --------------------------- */

  overview(scope: SecurityScope): Observable<SecurityOverview> {
    return this.api.get<SecurityOverview>(
      scope.kind === 'workspace'
        ? '/security'
        : `/superadmin/security/tenants/${encodeURIComponent(scope.tenantId)}`,
    );
  }

  employeeDevices(scope: SecurityScope, employeeId: string): Observable<readonly DeviceSession[]> {
    const employee = encodeURIComponent(employeeId);
    return this.api.get<readonly DeviceSession[]>(
      scope.kind === 'workspace'
        ? `/security/employees/${employee}/devices`
        : `/superadmin/security/tenants/${encodeURIComponent(scope.tenantId)}/employees/${employee}/devices`,
    );
  }

  /**
   * Suspends an account and ends every session it has. Returns the person's
   * row as it now stands. Refused with 403 for platform staff, yourself, or —
   * from a workspace — its admin.
   */
  suspend(scope: SecurityScope, userId: string, request: SuspendAccountRequest): Observable<SecurityEmployee> {
    return this.api.post<SecurityEmployee, SuspendAccountRequest>(`${this.personPath(scope, userId)}/suspend`, request);
  }

  reactivate(scope: SecurityScope, userId: string): Observable<SecurityEmployee> {
    return this.api.post<SecurityEmployee>(`${this.personPath(scope, userId)}/reactivate`);
  }

  private personPath(scope: SecurityScope, userId: string): string {
    const person = encodeURIComponent(userId);
    return scope.kind === 'workspace'
      ? `/security/employees/${person}`
      : `/superadmin/security/tenants/${encodeURIComponent(scope.tenantId)}/employees/${person}`;
  }

  revokeSession(scope: SecurityScope, sessionId: string): Observable<null> {
    const session = encodeURIComponent(sessionId);
    return this.api.post<null>(
      scope.kind === 'workspace'
        ? `/security/sessions/${session}/revoke`
        : `/superadmin/security/sessions/${session}/revoke`,
    );
  }
}
