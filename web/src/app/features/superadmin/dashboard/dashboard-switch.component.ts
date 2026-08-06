import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AdminScopeService } from '@core/scope/admin-scope.service';
import { DashboardComponent } from '@features/dashboard/dashboard.component';
import { GlobalDashboardComponent } from './global-dashboard.component';

/**
 * `/superadmin/dashboard` shows platform-wide figures by default and swaps to
 * the *exact* Admin dashboard component once an Admin is selected — so the
 * Super Admin sees precisely what that Admin sees, with no duplicated markup.
 */
@Component({
  selector: 'app-superadmin-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlobalDashboardComponent, DashboardComponent],
  template: `
    @if (scope.isScoped()) {
      <app-dashboard />
    } @else {
      <app-global-dashboard />
    }
  `,
})
export class SuperAdminDashboardComponent {
  protected readonly scope = inject(AdminScopeService);
}
