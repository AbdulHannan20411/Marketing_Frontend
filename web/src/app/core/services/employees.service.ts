import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { Employee, PermissionSet } from '@core/models/employee.model';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class EmployeesService {
  private readonly api = inject(ApiService);

  list(): Observable<readonly Employee[]> {
    return this.api.get<readonly Employee[]>('/employees');
  }

  listPermissionSets(): Observable<readonly PermissionSet[]> {
    return this.api.get<readonly PermissionSet[]>('/permission-sets');
  }
}
