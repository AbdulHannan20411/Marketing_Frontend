import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { AuthService } from '@core/auth/auth.service';
import type { AdminAccount } from '@core/models/admin-account.model';
import type { SearchResultGroup } from '@core/models/search.model';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { ApiService } from './api.service';

/**
 * What the global search looks through.
 *
 * Two different questions, because two different people are asking. Inside a
 * workspace it is "find this contact, campaign or template". For platform
 * staff standing outside every workspace it is "find this customer" — and
 * `GET /search` cannot answer that one at all: it resolves a tenant from the
 * caller, and an unscoped Super Admin has none, so the palette searched
 * nothing and said so by spinning forever.
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly scope = inject(AdminScopeService);

  /** True while the platform-wide search is the right one. */
  isPlatformSearch(): boolean {
    return this.auth.isSuperAdmin() && !this.scope.isScoped();
  }

  search(query: string): Observable<readonly SearchResultGroup[]> {
    return this.isPlatformSearch() ? this.searchWorkspaces(query) : this.searchWorkspace(query);
  }

  private searchWorkspace(query: string): Observable<readonly SearchResultGroup[]> {
    return this.api.get<readonly SearchResultGroup[]>('/search', { q: query });
  }

  /**
   * Customers, by organisation, admin name or email.
   *
   * Filtered here because `GET /superadmin/admins` answers with the whole list
   * and has no search of its own — see
   * `docs/API-PLATFORM-SEARCH-BACKEND.md`, which asks for one endpoint that
   * covers workspaces, plans and payments together. Until then this is the
   * half that matters: finding a customer.
   */
  private searchWorkspaces(query: string): Observable<readonly SearchResultGroup[]> {
    const term = query.trim().toLowerCase();

    return this.api.get<readonly AdminAccount[]>('/superadmin/admins').pipe(
      map((admins) => {
        const matches = admins
          .filter(
            (admin) =>
              admin.organisation.toLowerCase().includes(term) ||
              admin.name.toLowerCase().includes(term) ||
              admin.email.toLowerCase().includes(term),
          )
          .slice(0, 8);

        return matches.length === 0
          ? []
          : [
              {
                kind: 'employee' as const,
                label: 'Workspaces',
                results: matches.map((admin) => ({
                  id: admin.id,
                  kind: 'employee' as const,
                  title: admin.organisation,
                  subtitle: `${admin.name} · ${admin.email}`,
                  icon: 'building' as const,
                  route: `/superadmin/admins?admin=${admin.id}`,
                })),
              },
            ];
      }),
    );
  }
}
