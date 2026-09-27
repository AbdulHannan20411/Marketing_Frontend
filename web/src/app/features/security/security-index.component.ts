import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { latestRequest } from '@core/http/latest-request';

import type { LoadState } from '@core/models/api.model';
import type { WorkspaceSecuritySummary } from '@core/models/session-security.model';
import { SessionSecurityService } from '@core/services/session-security.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { serverPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/** Workspaces per page. */
const PAGE_SIZE = 10;

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
          <!--
            The per-page totals card is gone with the fan-out that fed it. It
            added up whichever ten workspaces were on screen and labelled
            itself "this page", which is not a platform summary — and it cost
            ten requests to draw. It returns with the paged workspace-security
            endpoint (see the backend notes).
          -->
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
                  @for (row of rows(); track row.tenantId) {
                    <tr class="border-b border-line/70 transition-colors last:border-0 hover:bg-surface-muted/60">
                      <td class="px-5 py-3">
                        <p class="font-medium text-ink">{{ row.organizationName }}</p>
                        <p class="font-mono text-[11px] text-ink-muted">{{ row.tenantId }}</p>
                      </td>
                      <td class="px-3 py-3 text-right tabular-nums text-ink-soft">{{ row.people }}</td>
                      <td class="px-3 py-3 text-right tabular-nums text-ink-soft">{{ row.activeSessions }}</td>
                      <td class="px-3 py-3">
                        <span class="flex flex-wrap gap-1.5">
                          @if (row.highRisk > 0) {
                            <span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200 ring-inset">
                              {{ row.highRisk }} high risk
                            </span>
                          }
                          @if (row.mediumRisk > 0) {
                            <span class="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">
                              {{ row.mediumRisk }} medium
                            </span>
                          }
                          @if (row.needsAttention > 0) {
                            <span class="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-soft ring-1 ring-line ring-inset">
                              {{ row.needsAttention }} worth a look
                            </span>
                          }
                          @if (row.highRisk === 0 && row.mediumRisk === 0 && row.needsAttention === 0) {
                            <span class="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200 ring-inset">
                              No concerns
                            </span>
                          }
                        </span>
                      </td>
                      <td class="px-5 py-3 text-right">
                        <a appButton variant="outline" size="sm" [routerLink]="['/superadmin/tenants', row.tenantId, 'security']">
                          Open
                          <app-icon name="chevronRight" [size]="14" />
                        </a>
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
                icon="building"
                title="No workspaces on this page"
                description="Go back a page, or refresh to read the list again."
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
  private readonly security = inject(SessionSecurityService);

  protected readonly breadcrumbs = [
    { label: 'Platform', route: null },
    { label: 'Security', route: null },
  ];
  protected readonly skeletons = [1, 2, 3, 4, 5];

  protected readonly state = signal<LoadState>('loading');
  /** The workspaces on this page, riskiest first, as the API ordered them. */
  protected readonly rows = signal<readonly WorkspaceSecuritySummary[]>([]);
  protected readonly totalItems = signal(0);

  private readonly listRequest = latestRequest();

  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
    pageSize: PAGE_SIZE,
  });

  constructor() {
    this.load();
  }

  /**
   * The whole screen, in one request.
   *
   * `GET /superadmin/security/summary` returns a page of workspaces with their
   * people, sessions and risk counts, ordered riskiest first across the
   * platform. This screen previously listed the admin accounts and then asked
   * about each workspace in turn — ten rows on screen meant eleven requests,
   * and its "riskiest first" order only held within whichever ten the browser
   * happened to have.
   */
  protected load(): void {
    this.state.set('loading');

    this.security
      .platformSummary(this.pager.page(), this.pager.pageSize())
      .pipe(this.listRequest.only())
      .subscribe({
        next: (page) => {
          this.rows.set(page.items);
          this.totalItems.set(page.totalItems);
          this.state.set(page.totalItems === 0 ? 'empty' : 'ready');
        },
        error: () => this.state.set('error'),
      });
  }




}
