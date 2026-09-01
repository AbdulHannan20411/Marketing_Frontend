import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import { AuthService } from '@core/auth/auth.service';
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
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { UpgradePromptComponent } from '@shared/ui/upgrade-prompt/upgrade-prompt.component';
import { UsageBarComponent } from '@shared/ui/usage-bar/usage-bar.component';
import { EmployeeInviteComponent, type InviteDraft } from './employee-invite.component';

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

/**
 * Granted to every workspace member by the API and not revocable.
 *
 * Kept as a list rather than a single value so adding to the floor later is
 * a one-line change here rather than a hunt through the editor.
 */
const PERMISSION_FLOOR: readonly Permission[] = ['dashboard.view'];

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
    ModalComponent,
    EmployeeInviteComponent,
  ],
  templateUrl: './employees.component.html',
})
export class EmployeesComponent {
  private readonly employeesService = inject(EmployeesService);
  private readonly entitlements = inject(EntitlementService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly employees = signal<readonly Employee[]>([]);
  protected readonly permissionSets = signal<readonly PermissionSet[]>([]);
  protected readonly tab = signal<EmployeeTab>('team');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly skeletons = [1, 2, 3, 4, 5];

  protected readonly inviting = signal(false);
  /** The employee whose row action is in flight, so only one runs at a time. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly removing = signal<Employee | null>(null);

  /**
   * You cannot act on your own row — the API rejects it with
   * `cannot_target_self`, and suspending or demoting yourself would lock you
   * out of the screen you are standing on. Matched by email, since the
   * employee list and the session are populated from different endpoints.
   */
  protected isSelf(employee: Employee): boolean {
    const me = this.auth.user();
    return me !== null && me.email.toLowerCase() === employee.email.toLowerCase();
  }

  private readonly adminCount = computed(
    () => this.employees().filter((employee) => employee.role === 'Admin').length,
  );

  /**
   * The last administrator cannot be demoted or removed: a workspace with no
   * admin cannot be recovered by its own members. The API returns
   * `409 last_admin`; disabling here explains it before they try.
   */
  protected isLastAdmin(employee: Employee): boolean {
    return employee.role === 'Admin' && this.adminCount() <= 1;
  }

  /** Remaining seats, or `null` when the plan grants an unlimited allowance. */
  protected readonly seatsLeft = computed(() => {
    const usage = this.seatUsage();
    if (usage === null || usage.limit === null) {
      return null;
    }
    return Math.max(0, usage.limit - usage.used);
  });

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
    return this.isFloor(permission) || this.effectivePermissions().has(permission);
  }

  /**
   * Permissions every member holds whatever the editor says.
   *
   * `dashboard.view` is a floor server-side: the API grants it regardless of
   * what is sent, because an employee invited with nothing ticked would land on
   * a dashboard they had no permission to see. Showing it as an unticked box
   * would be a lie — the box would appear to turn something off that the API
   * immediately turns back on.
   */
  protected isFloor(permission: Permission): boolean {
    return PERMISSION_FLOOR.includes(permission);
  }

  protected togglePermission(permission: Permission, granted: boolean): void {
    const employee = this.selected();
    if (employee === null || this.isFloor(permission)) {
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
      // Escalation and plan guards come back as 403 / 409.
      error: (error: ApiError) => {
        this.saving.set(false);
        if (error.errorCode === 'permission_not_in_plan') {
          this.toast.error(
            'Outside your plan',
            'One of those permissions belongs to a feature your plan does not include.',
          );
          return;
        }
        this.reportActionError(error);
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

  /* ------------------------------ invitation ------------------------------ */

  protected invite(): void {
    if (this.seatsExhausted()) {
      return;
    }
    this.inviting.set(true);
  }

  protected closeInvite(): void {
    this.inviting.set(false);
  }

  protected sendInvite(draft: InviteDraft): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);

    this.employeesService
      .invite({
        name: draft.name,
        email: draft.email,
        jobTitle: draft.jobTitle,
        role: draft.role,
        // Omitted rather than sent empty, so the API applies its own default.
        ...(draft.permissionSetId === '' ? {} : { permissionSetId: draft.permissionSetId }),
      })
      .subscribe({
        next: (employee) => {
          this.saving.set(false);
          this.inviting.set(false);
          this.employees.update((current) => [employee, ...current]);
          this.entitlements.load();
          this.toast.success(
            'Invitation sent',
            `${employee.name} will receive an email naming you as the sender.`,
          );
        },
        error: (error: ApiError) => {
          this.saving.set(false);
          this.reportInviteError(error, draft);
        },
      });
  }

  /**
   * The API's codes carry more than the generic detail does.
   *
   * `email_taken` is checked platform-wide, not per workspace, so "already in
   * your team" would be wrong — the address may belong to a different customer
   * entirely, and the admin needs to know that retrying will not help.
   */
  private reportInviteError(error: ApiError, draft: InviteDraft): void {
    switch (error.errorCode) {
      case 'email_taken':
        this.toast.error(
          'That address is already registered',
          `${draft.email} already has an account on this platform. They will need to use a different address.`,
        );
        return;

      case 'seat_limit_reached':
        this.toast.error('No seats left', error.detail);
        this.entitlements.load();
        return;

      case 'permission_not_in_plan':
        this.toast.error(
          'Outside your plan',
          'That permission set includes features your plan does not have. Choose another, or grant access after upgrading.',
        );
        return;

      default:
        // A 429 arrives without a code; the interceptor still fills in a detail.
        if (error.status === 429) {
          this.toast.error(
            'Too many invitations',
            'This workspace has hit its hourly invitation limit. Try again shortly.',
          );
          return;
        }
        this.toast.error(error.title, error.detail);
    }
  }

  /* ------------------------------ lifecycle ------------------------------ */

  private applyUpdate(updated: Employee): void {
    this.employees.update((current) =>
      current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
    );
  }

  private runAction(
    employee: Employee,
    action: Observable<unknown>,
    onDone: (result: unknown) => void,
  ): void {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(employee.id);

    action.subscribe({
      next: (result) => {
        this.busyId.set(null);
        onDone(result);
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.reportActionError(error);
      },
    });
  }

  /** Business rules the API enforces; the codes read better than the details. */
  private reportActionError(error: ApiError): void {
    switch (error.errorCode) {
      case 'last_admin':
        this.toast.error(
          'Someone has to be the administrator',
          'Promote another member to co-administrator first, then try again.',
        );
        return;
      case 'cannot_target_self':
        this.toast.error('You cannot do that to your own account', error.detail);
        return;
      case 'role_derived_permissions':
        this.toast.error(
          'Set by their role',
          'A co-administrator holds every permission. Make them an employee first to grant access individually.',
        );
        return;
      case 'not_invited':
        this.toast.error('Already accepted', 'They have joined, so there is no invitation to act on.');
        this.load();
        return;
      default:
        this.toast.error(error.title, error.detail);
    }
  }

  protected resendInvite(event: Event, employee: Employee): void {
    event.stopPropagation();
    this.runAction(employee, this.employeesService.resendInvite(employee.id), () =>
      this.toast.success('Invitation resent', `Sent again to ${employee.email}.`),
    );
  }

  protected revokeInvite(event: Event, employee: Employee): void {
    event.stopPropagation();
    this.runAction(employee, this.employeesService.revokeInvite(employee.id), () => {
      this.employees.update((current) => current.filter((c) => c.id !== employee.id));
      this.entitlements.load();
      this.toast.success('Invitation revoked', `${employee.name} can no longer join.`);
    });
  }

  protected setStatus(event: Event, employee: Employee, status: EmployeeStatus): void {
    event.stopPropagation();
    this.runAction(employee, this.employeesService.updateStatus(employee.id, status), (result) => {
      this.applyUpdate(result as Employee);
      this.toast.success(
        status === 'suspended' ? 'Access suspended' : 'Access restored',
        status === 'suspended'
          ? `${employee.name} has been signed out and cannot sign back in.`
          : `${employee.name} can sign in again.`,
      );
    });
  }

  protected setRole(event: Event, employee: Employee, role: 'Admin' | 'Employee'): void {
    event.stopPropagation();
    this.runAction(employee, this.employeesService.updateRole(employee.id, role), (result) => {
      this.applyUpdate(result as Employee);
      this.toast.success(
        'Role updated',
        role === 'Admin'
          ? `${employee.name} is now a co-administrator with full access.`
          : `${employee.name} is now restricted to their granted permissions.`,
      );
    });
  }

  protected confirmRemove(event: Event, employee: Employee): void {
    event.stopPropagation();
    this.removing.set(employee);
  }

  protected cancelRemove(): void {
    this.removing.set(null);
  }

  protected remove(): void {
    const employee = this.removing();
    if (employee === null) {
      return;
    }

    this.runAction(employee, this.employeesService.remove(employee.id), () => {
      this.removing.set(null);
      this.employees.update((current) => current.filter((c) => c.id !== employee.id));
      if (this.selectedId() === employee.id) {
        this.selectedId.set(null);
      }
      this.entitlements.load();
      this.toast.success('Employee removed', `${employee.name} no longer has access.`);
    });
  }
}
