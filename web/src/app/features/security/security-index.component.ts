import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
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
import { SearchBoxComponent } from '@shared/ui/search-box/search-box.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { clientPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/** How many workspaces are fetched at once — gentle on the admin rate limit. */
const CONCURRENCY = 4;

/** Workspaces per page. Each one on screen costs a request, so the page is small. */
const PAGE_SIZE = 10;

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
 * Built from the admin list plus each workspace's own overview, because the API
 * has no platform-wide summary yet. **Only the workspaces on the current page
 * are fetched**, a few at a time: a platform with 200 customers would otherwise
 * fire 200 requests to draw one screen. Within a page the riskiest come first,
 * and opening one shows every person, their devices, sessions and risk reasons.
 */
@Component({
  selector: 'app-security-index',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SearchBoxComponent,
    RouterLink,
    PageHeaderComponent,
    CardComponent,
    ButtonDirective,
    IconComponent,
    PaginatorComponent,
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
        <app-search-box
          class="w-full sm:w-64"
          [(value)]="search"
          label="Search workspaces"
          placeholder="Search workspace, admin or email"
        />
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
                <p class="text-xs font-medium text-ink-muted">High risk people <span class="text-ink-muted/70">· this page</span></p>
                <p class="mt-1 text-2xl font-semibold tabular-nums" [class]="total.high > 0 ? 'text-red-700' : 'text-ink'">
                  {{ total.high }}
                </p>
              </app-card>
              <app-card>
                <p class="text-xs font-medium text-ink-muted">Worth a look <span class="text-ink-muted/70">· this page</span></p>
                <p class="mt-1 text-2xl font-semibold tabular-nums" [class]="total.attention > 0 ? 'text-amber-700' : 'text-ink'">
                  {{ total.attention }}
                </p>
              </app-card>
              <app-card>
                <p class="text-xs font-medium text-ink-muted">Signed in now <span class="text-ink-muted/70">· this page</span></p>
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
                        } @else {
                          <!-- The security screens are addressed by workspace id,
                               and this account's row arrived without one. An
                               empty cell reads as a missing button; this says
                               which side the gap is on. -->
                          <span
                            class="text-xs text-ink-muted"
                            title="The admin list did not include this account's workspace id, so its security screen cannot be addressed."
                          >
                            No workspace id
                          </span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card>

          @if (rows().length === 0) {
            <app-card>
              <app-empty-state
                icon="search"
                title="No workspace matches that"
                description="Try part of the organisation name, the admin's name, or their email."
              />
            </app-card>
          }

          <app-paginator [pager]="pager" />
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

  protected readonly search = signal('');

  /** Matched on the workspace, the admin's name and their email. */
  private readonly matching = computed(() => {
    const term = this.search().trim().toLowerCase();
    return term === ''
      ? this.admins()
      : this.admins().filter(
          (admin) =>
            admin.organisation.toLowerCase().includes(term) ||
            admin.name.toLowerCase().includes(term) ||
            admin.email.toLowerCase().includes(term),
        );
  });

  /** In the API's order, so a row does not jump pages as its numbers arrive. */
  private readonly allRows = computed<readonly Row[]>(() => {
    const summaries = this.summaries();
    return this.matching().map((admin) => ({
      admin,
      summary: admin.tenantId ? (summaries.get(admin.tenantId) ?? null) : null,
    }));
  });

  protected readonly pager = clientPager(this.allRows, PAGE_SIZE);

  /** Riskiest first within the page; still-loading rows keep their place below. */
  protected readonly rows = computed<readonly Row[]>(() => {
    const weight = (row: Row): number =>
      row.summary?.state === 'ready' ? row.summary.high * 100 + row.summary.medium * 10 + row.summary.attention : -1;
    return [...this.pager.items()].sort((left, right) => weight(right) - weight(left));
  });

  /** Across this page only — the other pages have not been fetched. */
  protected readonly totals = computed(() => {
    const ready = this.pager
      .items()
      .map((row) => row.summary)
      .filter((summary): summary is TenantSummary => summary?.state === 'ready');
    return {
      high: ready.reduce((sum, summary) => sum + summary.high, 0),
      attention: ready.reduce((sum, summary) => sum + summary.attention, 0),
      signedIn: ready.reduce((sum, summary) => sum + summary.signedIn, 0),
    };
  });

  constructor() {
    this.load();

    // Fetch as the page changes, and once the admin list arrives.
    effect(() => {
      const tenantIds = this.pager
        .items()
        .map((row) => row.admin.tenantId)
        .filter((id): id is string => !!id);
      untracked(() => this.loadSummaries(tenantIds));
    });
  }

  protected load(): void {
    this.state.set('loading');
    // Cleared so Refresh really refetches the page's workspaces.
    this.summaries.set(new Map());

    this.platform.listAdmins().subscribe({
      next: (admins) => {
        this.admins.set(admins);
        this.state.set(admins.length === 0 ? 'empty' : 'ready');
        // The effect in the constructor fetches whichever page is on screen.
      },
      error: () => this.state.set('error'),
    });
  }

  /** Fetches the workspaces on screen that have not been fetched already. */
  private loadSummaries(tenantIds: readonly string[]): void {
    const known = this.summaries();
    const wanted = [...new Set(tenantIds)].filter((id) => !known.has(id));
    if (wanted.length === 0) {
      return;
    }

    const loading: TenantSummary = { state: 'loading', people: 0, signedIn: 0, high: 0, medium: 0, attention: 0 };
    this.summaries.update((current) => {
      const next = new Map(current);
      for (const id of wanted) {
        next.set(id, loading);
      }
      return next;
    });

    from(wanted)
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
