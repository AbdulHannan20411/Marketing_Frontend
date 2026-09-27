import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import {
  pagingParams,
  toAdaptivePage,
  type AdaptivePage,
  type ListQuery,
  type ServerListSupport,
} from '@core/http/adaptive-page';
import type { PagedResult } from '@core/models/api.model';
import type { Employee, EmployeeStatus, PermissionSet } from '@core/models/employee.model';
import type { Permission } from '@core/models/permission.model';
import type { WhatsAppAccess, WhatsAppAccessUpdate } from '@core/models/whatsapp-account.model';
import { comparatorFor } from './contacts.service';
import { sortParams, type SortColumn } from '@shared/ui/data-table/sort';
import { ApiService } from './api.service';

/**
 * What `/employees` does for itself.
 *
 * It pages and it searches — `EmployeeService.GetEmployeesAsync` applies
 * `query.Search` to the name and the email before counting and slicing. It
 * does not sort: the query ends `OrderBy(displayName)`, so a sorted request is
 * answered from the whole team here. See `docs/API-LIST-PAGINATION-BACKEND.md`.
 */
const EMPLOYEES_SERVER_SUPPORT: ServerListSupport = { search: true, sort: false };

/** What the team table can be ordered by. */
export const EMPLOYEE_SORT_COLUMNS: readonly SortColumn<Employee>[] = [
  { key: 'id', label: 'ID', kind: 'text', value: (employee) => employee.id },
  { key: 'name', label: 'Name', kind: 'text', value: (employee) => employee.name },
  { key: 'email', label: 'Email', kind: 'text', value: (employee) => employee.email },
  { key: 'role', label: 'Role', kind: 'text', value: (employee) => employee.role },
  { key: 'status', label: 'Status', kind: 'text', value: (employee) => employee.status },
  {
    key: 'invitedAt',
    label: 'Invited',
    kind: 'date',
    value: (employee) => employee.invitedAt,
    initialDirection: 'desc',
  },
  {
    key: 'lastActiveAt',
    label: 'Last active',
    kind: 'date',
    value: (employee) => employee.lastActiveAt,
    initialDirection: 'desc',
  },
];

export interface InviteEmployeeRequest {
  readonly email: string;
  readonly name: string;
  readonly jobTitle: string;
  readonly permissions?: readonly Permission[];
  readonly role?: 'Admin' | 'Employee';
  readonly permissionSetId?: string;
  readonly whatsAppAccess?: readonly WhatsAppAccess[];
  readonly defaultWhatsAppAccountId?: string | null;
}

export interface PermissionSetDraft {
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
}

@Injectable({ providedIn: 'root' })
export class EmployeesService {
  private readonly api = inject(ApiService);

  /**
   * The whole team.
   *
   * Still needed beside {@link page}: the permission matrix picks anyone from
   * a dropdown, the "last administrator" rule counts administrators across the
   * workspace, and the team counts describe everybody. A page of ten cannot
   * answer any of those, and a roster is bounded by the plan's seat limit.
   */
  list(): Observable<readonly Employee[]> {
    return this.api.get<readonly Employee[]>('/employees');
  }

  /** One page of the team, searched by the API. */
  page(query: ListQuery): Observable<AdaptivePage<Employee>> {
    return this.api
      .get<PagedResult<Employee> | readonly Employee[]>('/employees', {
        ...pagingParams(query, EMPLOYEES_SERVER_SUPPORT),
        ...(query.search?.trim() ? { search: query.search.trim() } : {}),
        ...sortParams(query.sortBy, query.sortDirection),
      })
      .pipe(
        map((response) =>
          toAdaptivePage(response, query, {
            matches: (employee, term) =>
              term === '' ||
              employee.name.toLowerCase().includes(term) ||
              employee.email.toLowerCase().includes(term) ||
              employee.jobTitle.toLowerCase().includes(term),
            compare: (current) => comparatorFor(EMPLOYEE_SORT_COLUMNS, current),
          }),
        ),
      );
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

  /**
   * Replaces which WhatsApp numbers this person works on, and what they may do
   * on each. Rejected for an Admin, who always has every number.
   */
  updateWhatsAppAccess(id: string, update: WhatsAppAccessUpdate): Observable<Employee> {
    return this.api.put<Employee, WhatsAppAccessUpdate>(`/employees/${id}/whatsapp-access`, update);
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
