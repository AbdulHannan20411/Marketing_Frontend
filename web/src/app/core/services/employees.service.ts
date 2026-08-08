import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { Employee, EmployeeStatus, PermissionSet } from '@core/models/employee.model';
import type { Permission } from '@core/models/permission.model';
import { ApiService } from './api.service';

export interface InviteEmployeeRequest {
  readonly email: string;
  readonly name: string;
  readonly jobTitle: string;
  readonly permissions?: readonly Permission[];
  readonly role?: 'Admin' | 'Employee';
  readonly permissionSetId?: string;
}

export interface PermissionSetDraft {
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
}

@Injectable({ providedIn: 'root' })
export class EmployeesService {
  private readonly api = inject(ApiService);

  list(): Observable<readonly Employee[]> {
    return this.api.get<readonly Employee[]>('/employees');
  }

  invite(request: InviteEmployeeRequest): Observable<Employee> {
    return this.api.post<Employee, InviteEmployeeRequest>('/employees/invite', request);
  }

  update(
    id: string,
    changes: { name?: string; jobTitle?: string; email?: string },
  ): Observable<Employee> {
    return this.api.put<Employee>(`/employees/${id}`, changes);
  }

  /** Complete replacement set, not a delta. Revokes their sessions immediately. */
  updatePermissions(id: string, permissions: readonly Permission[]): Observable<Employee> {
    return this.api.put<Employee>(`/employees/${id}/permissions`, { permissions });
  }

  updateRole(id: string, role: 'Admin' | 'Employee'): Observable<Employee> {
    return this.api.put<Employee>(`/employees/${id}/role`, { role });
  }

  updateStatus(id: string, status: EmployeeStatus): Observable<Employee> {
    return this.api.put<Employee>(`/employees/${id}/status`, { status });
  }

  resendInvite(id: string): Observable<null> {
    return this.api.post<null>(`/employees/${id}/resend-invite`);
  }

  revokeInvite(id: string): Observable<null> {
    return this.api.delete(`/employees/${id}/invite`);
  }

  remove(id: string): Observable<null> {
    return this.api.delete(`/employees/${id}`);
  }

  /* ------------------------------ permission sets ------------------------------ */

  listPermissionSets(): Observable<readonly PermissionSet[]> {
    return this.api.get<readonly PermissionSet[]>('/permission-sets');
  }

  createPermissionSet(draft: PermissionSetDraft): Observable<PermissionSet> {
    return this.api.post<PermissionSet, PermissionSetDraft>('/permission-sets', draft);
  }

  updatePermissionSet(id: string, draft: Partial<PermissionSetDraft>): Observable<PermissionSet> {
    return this.api.put<PermissionSet, Partial<PermissionSetDraft>>(
      `/permission-sets/${id}`,
      draft,
    );
  }

  deletePermissionSet(id: string): Observable<null> {
    return this.api.delete(`/permission-sets/${id}`);
  }

  /** Overwrites each target's permissions; subject to every employee guard. */
  applyPermissionSet(id: string, employeeIds: readonly string[]): Observable<readonly Employee[]> {
    return this.api.post<readonly Employee[]>(`/permission-sets/${id}/apply`, { employeeIds });
  }
}
