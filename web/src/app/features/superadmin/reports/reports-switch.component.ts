import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AdminScopeService } from '@core/scope/admin-scope.service';
import { ReportsComponent } from '@features/reports/reports.component';
import { GlobalReportsComponent } from './global-reports.component';

/**
 * Global reports by default; the Admin's own Reports component once scoped, so
 * filters, calculations, charts and tables are identical by construction.
 */
@Component({
  selector: 'app-superadmin-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GlobalReportsComponent, ReportsComponent],
  template: `
    @if (scope.isScoped()) {
      <app-reports />
    } @else {
      <app-global-reports />
    }
  `,
})
export class SuperAdminReportsComponent {
  protected readonly scope = inject(AdminScopeService);
}
