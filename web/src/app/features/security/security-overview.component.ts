import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

import type { ApiError, LoadState } from '@core/models/api.model';
import {
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
@Component({
  selector: 'app-security-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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

  protected readonly employees = computed(() => sortForReview(this.overview()?.employees ?? []));
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
