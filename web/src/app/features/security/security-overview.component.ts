import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError, LoadState } from '@core/models/api.model';
import { isSamePerson } from '@core/models/employee.model';
import {
  canSuspendFrom,
  isPlatformStaff,
  isSuspended,
  securityAlertLevel,
  suspendNeedsConfirmation,
  SUSPEND_REASON_MAX,
  type SecurityAlertLevel,
  DEVICE_ALERT_THRESHOLD,
  DISPLACEMENT_ALERT_THRESHOLD,
  hasManyDevices,
  isFrequentlyDisplaced,
  needsAttention,
  sortForReview,
  type DeviceSession,
  type RiskLevel,
  type SecurityEmployee,
  type SecurityOverview,
  type SecurityScope,
} from '@core/models/session-security.model';
import { SessionSecurityService } from '@core/services/session-security.service';
import { ToastService } from '@core/services/toast.service';
import { clientSorter, type SortColumn } from '@shared/ui/data-table/sort';
import { SortHeaderComponent } from '@shared/ui/data-table/sort-header.component';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { DeviceListComponent } from './device-list.component';

const RISK_CLASS: Readonly<Record<RiskLevel, string>> = {
  high: 'bg-red-50 text-red-700 ring-red-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low: 'bg-green-50 text-green-700 ring-green-200',
};

/**
 * Who is signed in where, for one workspace.
 *
 * Two audiences, one screen:
 *
 * - **Workspace admins** (Settings → Security) see facts about their own staff
 *   — devices, sessions, how often a sign-in pushed another off — and never a
 *   risk label. Being called a suspected cheat by your own employer's software
 *   is not a fact, and the API withholds it.
 * - **Platform staff** (a tenant's Security page) also see the risk score and,
 *   more importantly, its reasons: the evidence for a customer who disputes it.
 */
/**
 * What the team's security table can be ordered by.
 *
 * `SecurityEmployee` carries no created/modified pair — it is a live view of
 * sessions and devices, not a stored record — so `lastActiveAt` is the only
 * time column, and it is the one that matters here.
 */
const SECURITY_SORT_COLUMNS: readonly SortColumn<SecurityEmployee>[] = [
  { key: 'name', label: 'Person', kind: 'text', value: (employee) => employee.name },
  { key: 'role', label: 'Role', kind: 'text', value: (employee) => employee.role },
  {
    key: 'activeSessions',
    label: 'Signed in',
    kind: 'number',
    value: (employee) => employee.activeSessions,
    initialDirection: 'desc',
  },
  {
    key: 'devices',
    label: 'Devices',
    kind: 'number',
    value: (employee) => employee.devices,
    initialDirection: 'desc',
  },
  {
    key: 'displacedLast24Hours',
    label: 'Pushed off',
    kind: 'number',
    value: (employee) => employee.displacedLast24Hours,
    initialDirection: 'desc',
  },
  {
    key: 'lastActiveAt',
    label: 'Last active',
    kind: 'date',
    value: (employee) => employee.lastActiveAt,
    initialDirection: 'desc',
  },
  {
    key: 'risk',
    label: 'Risk',
    kind: 'number',
    value: (employee) => employee.risk?.score ?? null,
    initialDirection: 'desc',
  },
];

@Component({
  selector: 'app-security-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SortHeaderComponent,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    ButtonDirective,
    IconComponent,
    ModalComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    DeviceListComponent,
  ],
  templateUrl: './security-overview.component.html',
})
export class SecurityOverviewComponent {
  /** From route data: which endpoints to use and whether risk is shown. */
  readonly view = input<'workspace' | 'platform'>('workspace');
  /** From the route, on the platform view only. */
  readonly tenantId = input<string | undefined>(undefined);

  private readonly security = inject(SessionSecurityService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly deviceThreshold = DEVICE_ALERT_THRESHOLD;
  protected readonly displacementThreshold = DISPLACEMENT_ALERT_THRESHOLD;
  protected readonly riskClass = RISK_CLASS;
  protected readonly skeletons = [1, 2, 3, 4];

  protected readonly scope = computed<SecurityScope>(() => {
    const tenantId = this.tenantId();
    return this.view() === 'platform' && tenantId !== undefined
      ? { kind: 'platform', tenantId }
      : { kind: 'workspace' };
  });

  protected readonly isPlatform = computed(() => this.scope().kind === 'platform');

  protected readonly state = signal<LoadState>('loading');
  protected readonly overview = signal<SecurityOverview | null>(null);

  /** Platform staff are outside session security, so never listed even if an API sends them. */
  /**
   * Default order: riskiest first, which is what this screen is for.
   *
   * `sorter` re-orders this set when somebody picks a column; with no column
   * chosen it hands back exactly this list, so the default review order is
   * still what greets you.
   */
  private readonly forReview = computed(() =>
    sortForReview((this.overview()?.employees ?? []).filter((employee) => !isPlatformStaff(employee))),
  );

  protected readonly sorter = clientSorter(this.forReview, SECURITY_SORT_COLUMNS);

  protected readonly employees = this.sorter.rows;
  protected readonly attentionCount = computed(() => this.employees().filter(needsAttention).length);

  protected readonly breadcrumbs = computed(() =>
    this.isPlatform()
      ? [
          { label: 'Platform', route: null },
          { label: 'Security', route: '/superadmin/security' },
          { label: this.overview()?.organizationName ?? 'Security', route: null },
        ]
      : [
          { label: 'Settings', route: '/settings' },
          { label: 'Security', route: null },
        ],
  );

  /* --------------------------- one person's devices --------------------------- */

  protected readonly inspecting = signal<SecurityEmployee | null>(null);
  protected readonly devicesState = signal<LoadState>('idle');
  protected readonly devices = signal<readonly DeviceSession[]>([]);
  protected readonly revokingId = signal<string | null>(null);

  protected readonly manyDevices = hasManyDevices;
  protected readonly oftenDisplaced = isFrequentlyDisplaced;

  /* ------------------------------- suspending ------------------------------- */

  protected readonly suspended = isSuspended;
  protected readonly alertLevel = securityAlertLevel;
  protected readonly reasonMax = SUSPEND_REASON_MAX;
  /** Row whose suspend or reactivate call is in flight. */
  protected readonly busyId = signal<string | null>(null);
  /** Low-risk suspensions wait here for a yes. */
  protected readonly confirming = signal<SecurityEmployee | null>(null);
  protected readonly suspendReason = signal('');

  protected canSuspend(employee: SecurityEmployee): boolean {
    return canSuspendFrom(employee, this.view(), isSamePerson(this.auth.user()?.id, employee.userId));
  }

  /** Low risk asks first; a warning or worse acts at once. */
  protected requestSuspend(employee: SecurityEmployee): void {
    if (!this.canSuspend(employee) || this.busyId() !== null) {
      return;
    }
    const level = securityAlertLevel(employee);
    if (suspendNeedsConfirmation(level)) {
      this.suspendReason.set('');
      this.confirming.set(employee);
      return;
    }
    this.suspend(employee, level, null);
  }

  protected confirmSuspend(): void {
    const employee = this.confirming();
    if (employee === null) {
      return;
    }
    const reason = this.suspendReason().trim();
    this.suspend(employee, securityAlertLevel(employee), reason === '' ? null : reason.slice(0, SUSPEND_REASON_MAX));
  }

  private suspend(employee: SecurityEmployee, alertLevel: SecurityAlertLevel, reason: string | null): void {
    this.busyId.set(employee.userId);
    this.security.suspend(this.scope(), employee.userId, { reason, alertLevel }).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.confirming.set(null);
        this.replaceRow({ ...employee, ...updated, status: updated.status ?? 'suspended', activeSessions: 0 });
        if (this.inspecting()?.userId === employee.userId) {
          this.inspecting.set(null);
        }
        this.toast.success(
          `${employee.name} is suspended`,
          'Signed out on every device. They cannot sign in again until reactivated.',
        );
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title || 'Could not suspend', error.detail || 'Please try again.');
      },
    });
  }

  protected reactivate(employee: SecurityEmployee): void {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(employee.userId);
    this.security.reactivate(this.scope(), employee.userId).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.replaceRow({ ...employee, ...updated, status: updated.status ?? 'active' });
        this.toast.success(`${employee.name} is active again`, 'They can sign in now.');
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title || 'Could not reactivate', error.detail || 'Please try again.');
      },
    });
  }

  private replaceRow(row: SecurityEmployee): void {
    this.overview.update((current) =>
      current === null
        ? null
        : {
            ...current,
            employees: current.employees.map((entry) => (entry.userId === row.userId ? row : entry)),
          },
    );
  }

  constructor() {
    effect(() => {
      const scope = this.scope();
      untracked(() => this.load(scope));
    });
  }

  protected load(scope: SecurityScope = this.scope()): void {
    this.state.set('loading');
    this.security.overview(scope).subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.state.set(overview.employees.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected inspect(employee: SecurityEmployee): void {
    this.inspecting.set(employee);
    this.devicesState.set('loading');
    this.devices.set([]);

    this.security.employeeDevices(this.scope(), employee.userId).subscribe({
      next: (devices) => {
        this.devices.set(devices);
        this.devicesState.set(devices.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.devicesState.set('error'),
    });
  }

  protected revoke(device: DeviceSession): void {
    const employee = this.inspecting();
    this.revokingId.set(device.sessionId);

    this.security.revokeSession(this.scope(), device.sessionId).subscribe({
      next: () => {
        this.revokingId.set(null);
        this.devices.update((current) =>
          current.map((entry) => (entry.sessionId === device.sessionId ? { ...entry, isActive: false, canRevoke: false } : entry)),
        );
        this.toast.success(
          'Session ended',
          `${employee?.name ?? 'They'} ${employee === null ? 'are' : 'is'} signed out of ${device.deviceLabel} within half a minute.`,
        );
        // Counts change with the revoke; refresh them quietly.
        this.security.overview(this.scope()).subscribe({ next: (overview) => this.overview.set(overview), error: () => undefined });
      },
      error: (error: ApiError) => {
        this.revokingId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
