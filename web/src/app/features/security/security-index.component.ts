import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, from, map, mergeMap, of } from 'rxjs';

import type { AdminAccount } from '@core/models/admin-account.model';
import type { LoadState } from '@core/models/api.model';
import { needsAttention, type SecurityOverview } from '@core/models/session-security.model';
import { PlatformService } from '@core/services/platform.service';
import { SessionSecurityService } from '@core/services/session-security.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/** How many workspaces are fetched at once — gentle on the admin rate limit. */
const CONCURRENCY = 4;

interface TenantSummary {
  readonly state: 'loading' | 'ready' | 'error';
  readonly people: number;
  readonly signedIn: number;
  readonly high: number;
  readonly medium: number;
  /** Over a device or displacement threshold. */
  readonly attention: number;
}

interface Row {
  readonly admin: AdminAccount;
  readonly summary: TenantSummary | null;
}

function summarise(overview: SecurityOverview): TenantSummary {
  return {
    state: 'ready',
    people: overview.employees.length,
    signedIn: overview.activeSessions,
    high: overview.employees.filter((employee) => employee.risk?.level === 'high').length,
    medium: overview.employees.filter((employee) => employee.risk?.level === 'medium').length,
    attention: overview.employees.filter(needsAttention).length,
  };
}

/**
 * Every workspace's security at a glance, for platform staff.
 *
 * Built from the admin list plus each workspace's own overview, fetched a few
 * at a time, because the API has no platform-wide summary yet. The riskiest
 * workspaces rise to the top as their numbers arrive; opening one shows every
 * person, their devices, sessions and risk reasons.
 */
@Component({
  selector: 'app-security-index',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageHeaderComponent,
    CardComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  template: `
    <div class="animate-fade-in space-y-6">
      <app-page-header
        title="Security"
        description="Sessions, devices and shared-login risk in every workspace. Open one to see each person and the reasons behind their risk."
        [breadcrumbs]="breadcrumbs"
      >
        <button appButton variant="outline" size="md" (click)="load()">
          <app-icon name="refresh" [size]="16" />
          Refresh
        </button>
      </app-page-header>

      @switch (state()) {
        @case ('loading') {
          <app-card>
            <div class="space-y-3" aria-busy="true">
              @for (row of skeletons; track row) {
                <app-skeleton height="3.25rem" />
              }
            </div>
          </app-card>
        }
        @case ('error') {
          <app-card>
            <app-error-state
              title="Could not load workspaces"
              description="Nothing has changed. Try again in a moment."
              (retry)="load()"
            />
          </app-card>
        }
        @case ('empty') {
          <app-card>
            <app-empty-state icon="building" title="No workspaces yet" description="Workspaces appear here once an admin account exists." />
          </app-card>
        }
        @default {
          @if (totals(); as total) {
            <section class="grid gap-4 sm:grid-cols-3" aria-label="Platform security summary">
              <app-card>
                <p class="text-xs font-medium text-ink-muted">High risk people</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums" [class]="total.high > 0 ? 'text-red-700' : 'text-ink'">
                  {{ total.high }}
                </p>
              </app-card>
              <app-card>
                <p class="text-xs font-medium text-ink-muted">Worth a look</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums" [class]="total.attention > 0 ? 'text-amber-700' : 'text-ink'">
                  {{ total.attention }}
                </p>
              </app-card>
              <app-card>
                <p class="text-xs font-medium text-ink-muted">Signed in now</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{{ total.signedIn }}</p>
              </app-card>
            </section>
          }

          <app-card [padded]="false">
            <div class="overflow-x-auto">
              <table class="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr class="border-b border-line text-left text-xs tracking-wide text-ink-muted uppercase">
                    <th scope="col" class="px-5 py-3 font-medium">Workspace</th>
                    <th scope="col" class="px-3 py-3 text-right font-medium">People</th>
                    <th scope="col" class="px-3 py-3 text-right font-medium">Signed in</th>
                    <th scope="col" class="px-3 py-3 font-medium">Indicators</th>
                    <th scope="col" class="px-5 py-3"><span class="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.admin.id) {
                    <tr class="border-b border-line/70 transition-colors last:border-0 hover:bg-surface-muted/60">
                      <td class="px-5 py-3">
                        <p class="font-medium text-ink">{{ row.admin.organisation }}</p>
                        <p class="text-xs text-ink-muted">{{ row.admin.name }} · {{ row.admin.email }}</p>
                      </td>
                      @if (row.summary; as summary) {
                        @if (summary.state === 'loading') {
                          <td class="px-3 py-3" colspan="3"><app-skeleton height="1rem" width="60%" /></td>
                        } @else if (summary.state === 'error') {
                          <td class="px-3 py-3 text-xs text-ink-muted" colspan="3">Could not load this workspace</td>
                        } @else {
                          <td class="px-3 py-3 text-right tabular-nums text-ink-soft">{{ summary.people }}</td>
                          <td class="px-3 py-3 text-right tabular-nums text-ink-soft">{{ summary.signedIn }}</td>
                          <td class="px-3 py-3">
                            <span class="flex flex-wrap gap-1.5">
                              @if (summary.high > 0) {
                                <span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200 ring-inset">
                                  {{ summary.high }} high risk
                                </span>
                              }
                              @if (summary.medium > 0) {
                                <span class="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">
                                  {{ summary.medium }} medium
                                </span>
                              }
                              @if (summary.attention > 0) {
                                <span class="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-soft ring-1 ring-line ring-inset">
                                  {{ summary.attention }} worth a look
                                </span>
                              }
                              @if (summary.high === 0 && summary.medium === 0 && summary.attention === 0) {
                                <span class="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200 ring-inset">
                                  No concerns
                                </span>
                              }
                            </span>
                          </td>
                        }
                      } @else {
                        <!-- Needs tenantId on the admin list, which the API is adding. -->
                        <td class="px-3 py-3 text-xs text-ink-muted" colspan="3">Available once the API sends the workspace id</td>
                      }
                      <td class="px-5 py-3 text-right">
                        @if (row.admin.tenantId; as tenantId) {
                          <a appButton variant="outline" size="sm" [routerLink]="['/superadmin/tenants', tenantId, 'security']">
                            Open
                            <app-icon name="chevronRight" [size]="14" />
                          </a>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card>
        }
      }
    </div>
  `,
})
export class SecurityIndexComponent {
  private readonly platform = inject(PlatformService);
  private readonly security = inject(SessionSecurityService);

  protected readonly breadcrumbs = [
    { label: 'Platform', route: null },
    { label: 'Security', route: null },
  ];
  protected readonly skeletons = [1, 2, 3, 4, 5];

  protected readonly state = signal<LoadState>('loading');
  private readonly admins = signal<readonly AdminAccount[]>([]);
  private readonly summaries = signal<ReadonlyMap<string, TenantSummary>>(new Map());

  /** Riskiest first, once their numbers are in; still-loading rows keep their place below. */
  protected readonly rows = computed<readonly Row[]>(() => {
    const summaries = this.summaries();
    const rows = this.admins().map((admin) => ({
      admin,
      summary: admin.tenantId ? (summaries.get(admin.tenantId) ?? null) : null,
    }));
    const weight = (row: Row): number =>
      row.summary?.state === 'ready' ? row.summary.high * 100 + row.summary.medium * 10 + row.summary.attention : -1;
    return [...rows].sort((left, right) => weight(right) - weight(left));
  });

  protected readonly totals = computed(() => {
    const ready = [...this.summaries().values()].filter((summary) => summary.state === 'ready');
    return {
      high: ready.reduce((sum, summary) => sum + summary.high, 0),
      attention: ready.reduce((sum, summary) => sum + summary.attention, 0),
      signedIn: ready.reduce((sum, summary) => sum + summary.signedIn, 0),
    };
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.summaries.set(new Map());

    this.platform.listAdmins().subscribe({
      next: (admins) => {
        this.admins.set(admins);
        this.state.set(admins.length === 0 ? 'empty' : 'ready');
        this.loadSummaries(admins);
      },
      error: () => this.state.set('error'),
    });
  }

  private loadSummaries(admins: readonly AdminAccount[]): void {
    const tenantIds = [...new Set(admins.map((admin) => admin.tenantId).filter((id): id is string => !!id))];
    const loading: TenantSummary = { state: 'loading', people: 0, signedIn: 0, high: 0, medium: 0, attention: 0 };
    this.summaries.set(new Map(tenantIds.map((id) => [id, loading])));

    from(tenantIds)
      .pipe(
        mergeMap(
          (tenantId) =>
            this.security.overview({ kind: 'platform', tenantId }).pipe(
              map((overview) => [tenantId, summarise(overview)] as const),
              catchError(() => of([tenantId, { ...loading, state: 'error' as const }] as const)),
            ),
          CONCURRENCY,
        ),
      )
      .subscribe(([tenantId, summary]) =>
        this.summaries.update((current) => new Map(current).set(tenantId, summary)),
      );
  }
}
