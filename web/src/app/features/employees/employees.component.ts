import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { ApiError, LoadState } from '@core/models/api.model';
import { USER_ROLE_LABEL, type UserRole } from '@core/models/auth.model';
import type { Employee, EmployeeStatus, PermissionSet } from '@core/models/employee.model';
import {
  PERMISSION_CATALOGUE,
  type Permission,
  type PermissionCategory,
} from '@core/models/permission.model';
import { EmployeesService } from '@core/services/employees.service';
import { EntitlementService } from '@core/services/entitlement.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { ToggleComponent } from '@shared/ui/toggle/toggle.component';
import { UpgradePromptComponent } from '@shared/ui/upgrade-prompt/upgrade-prompt.component';
import { UsageBarComponent } from '@shared/ui/usage-bar/usage-bar.component';

type EmployeeTab = 'team' | 'matrix' | 'sets';

const STATUS_TONE: Readonly<Record<EmployeeStatus, BadgeTone>> = {
  active: 'success',
  invited: 'info',
  suspended: 'danger',
};

const ROLE_TONE: Readonly<Record<UserRole, BadgeTone>> = {
  SuperAdmin: 'danger',
  Admin: 'brand',
  Employee: 'neutral',
};

@Component({
  selector: 'app-employees',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    AvatarComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
    ToggleComponent,
    UsageBarComponent,
    UpgradePromptComponent,
  ],
  templateUrl: './employees.component.html',
})
export class EmployeesComponent {
  private readonly employeesService = inject(EmployeesService);
  private readonly entitlements = inject(EntitlementService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly employees = signal<readonly Employee[]>([]);
  protected readonly permissionSets = signal<readonly PermissionSet[]>([]);
  protected readonly tab = signal<EmployeeTab>('team');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly skeletons = [1, 2, 3, 4, 5];

  /** Local permission edits, keyed by employee id, until saved. */
  private readonly draftPermissions = signal<ReadonlyMap<string, ReadonlySet<Permission>>>(
    new Map(),
  );

  protected readonly catalogue: readonly PermissionCategory[] = PERMISSION_CATALOGUE;
  protected readonly statusTone = STATUS_TONE;
  protected readonly roleTone = ROLE_TONE;
  protected readonly roleLabel = USER_ROLE_LABEL;

  protected readonly seatUsage = computed(() => this.entitlements.usageFor('employees'));
  protected readonly seatsExhausted = computed(() => this.seatUsage()?.severity === 'exceeded');

  protected readonly tabs: readonly { value: EmployeeTab; label: string }[] = [
    { value: 'team', label: 'Team' },
    { value: 'matrix', label: 'Permission matrix' },
    { value: 'sets', label: 'Permission sets' },
  ];

  protected readonly selected = computed<Employee | null>(() => {
    const id = this.selectedId();
    return this.employees().find((employee) => employee.id === id) ?? null;
  });

  protected readonly counts = computed(() => {
    const all = this.employees();
    return {
      total: all.length,
      active: all.filter((employee) => employee.status === 'active').length,
      invited: all.filter((employee) => employee.status === 'invited').length,
    };
  });

  /** Permissions the selected employee currently holds, including unsaved edits. */
  protected readonly effectivePermissions = computed<ReadonlySet<Permission>>(() => {
    const employee = this.selected();
    if (employee === null) {
      return new Set();
    }
    return this.draftPermissions().get(employee.id) ?? new Set(employee.permissions);
  });

  protected readonly hasUnsavedChanges = computed(() => {
    const employee = this.selected();
    return employee !== null && this.draftPermissions().has(employee.id);
  });

  protected readonly grantedCount = computed(() => this.effectivePermissions().size);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');

    this.employeesService.list().subscribe({
      next: (employees) => {
        this.employees.set(employees);
        this.selectedId.set(
          employees.find((employee) => employee.role === 'Employee')?.id ??
            employees[0]?.id ??
            null,
        );
        this.state.set(employees.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });

    this.employeesService.listPermissionSets().subscribe({
      next: (sets) => this.permissionSets.set(sets),
    });
  }

  protected select(employee: Employee): void {
    this.selectedId.set(employee.id);
    this.tab.set('matrix');
  }

  protected isGranted(permission: Permission): boolean {
    return this.effectivePermissions().has(permission);
  }

  protected togglePermission(permission: Permission, granted: boolean): void {
    const employee = this.selected();
    if (employee === null) {
      return;
    }

    const next = new Set(this.effectivePermissions());
    if (granted) {
      next.add(permission);
    } else {
      next.delete(permission);
    }

    this.draftPermissions.update((current) => new Map(current).set(employee.id, next));
  }

  protected categoryGrantedCount(category: PermissionCategory): number {
    const granted = this.effectivePermissions();
    return category.permissions.filter((permission) => granted.has(permission.key)).length;
  }

  protected isCategoryFullyGranted(category: PermissionCategory): boolean {
    return this.categoryGrantedCount(category) === category.permissions.length;
  }

  protected toggleCategory(category: PermissionCategory, granted: boolean): void {
    const employee = this.selected();
    if (employee === null) {
      return;
    }

    const next = new Set(this.effectivePermissions());
    for (const permission of category.permissions) {
      if (granted) {
        next.add(permission.key);
      } else {
        next.delete(permission.key);
      }
    }

    this.draftPermissions.update((current) => new Map(current).set(employee.id, next));
  }

  /** A category whose module is not in the plan is shown but locked. */
  protected isCategoryLocked(category: PermissionCategory): boolean {
    return category.module !== null && !this.entitlements.hasFeature(category.module);
  }

  protected applySet(set: PermissionSet): void {
    const employee = this.selected();
    if (employee === null) {
      this.toast.warning('Select an employee first', 'Choose who this set should apply to.');
      return;
    }

    this.draftPermissions.update((current) =>
      new Map(current).set(employee.id, new Set(set.permissions)),
    );
    this.tab.set('matrix');
    this.toast.info(`${set.name} applied`, `Review and save to update ${employee.name}.`);
  }

  protected savePermissions(): void {
    const employee = this.selected();
    if (employee === null || this.saving()) {
      return;
    }

    const granted = [...this.effectivePermissions()];
    this.saving.set(true);

    this.employeesService.updatePermissions(employee.id, granted).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.employees.update((current) =>
          current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
        );
        this.draftPermissions.update((current) => {
          const next = new Map(current);
          next.delete(employee.id);
          return next;
        });
        this.toast.success(
          'Permissions updated',
          `${updated.name} now holds ${updated.permissions.length} permissions. Their sessions were signed out.`,
        );
      },
      // Escalation and plan guards come back as 403 / 409 with a usable detail.
      error: (error: ApiError) => {
        this.saving.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected discardChanges(): void {
    const employee = this.selected();
    if (employee === null) {
      return;
    }
    this.draftPermissions.update((current) => {
      const next = new Map(current);
      next.delete(employee.id);
      return next;
    });
  }

  protected invite(): void {
    if (this.seatsExhausted()) {
      return;
    }
    this.toast.info('Invite employee', 'The invitation flow lands with the team-management milestone.');
  }
}
