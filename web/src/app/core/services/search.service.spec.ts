import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { environment } from '@env/environment';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { SearchService } from './search.service';

/**
 * Two different questions behind one box: "find this contact" inside a
 * workspace, "find this customer" outside every workspace. `GET /search`
 * resolves a tenant from the caller, so for unscoped platform staff it can
 * only ever answer nothing.
 */
describe('SearchService', () => {
  let http: HttpTestingController;

  const BASE = environment.apiBaseUrl;

  function configure(isSuperAdmin: boolean, scoped: boolean): SearchService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isSuperAdmin: signal(isSuperAdmin) } },
        {
          provide: AdminScopeService,
          useValue: { isScoped: signal(scoped), selectedId: signal(scoped ? 'adm_1' : null) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(SearchService);
  }

  afterEach(() => http.verify());

  it('searches the workspace for an ordinary admin', () => {
    const search = configure(false, false);

    search.search('ayesha').subscribe();

    const request = http.expectOne((candidate) => candidate.url === `${BASE}/search`);
    expect(request.request.params.get('q')).toBe('ayesha');
    request.flush({ data: [] });
  });

  it('searches customers for platform staff outside a workspace', () => {
    const search = configure(true, false);
    let groups: readonly { label: string; results: readonly { title: string }[] }[] = [];

    search.search('metro').subscribe((result) => (groups = result));

    http.expectOne(`${BASE}/superadmin/admins`).flush({
      data: [
        { id: 'adm_1', organisation: 'Metro Guest House', name: 'Ali', email: 'ali@metro.pk' },
        { id: 'adm_2', organisation: 'Other Co', name: 'Sara', email: 'sara@other.com' },
      ],
    });

    expect(groups.length).toBe(1);
    expect(groups[0].label).toBe('Workspaces');
    expect(groups[0].results.map((result) => result.title)).toEqual(['Metro Guest House']);
  });

  it('searches the chosen workspace once platform staff have scoped themselves', () => {
    const search = configure(true, true);

    search.search('ayesha').subscribe();

    // Scoped, the tenant exists and the ordinary search is the right one.
    http.expectOne((candidate) => candidate.url === `${BASE}/search`).flush({ data: [] });
  });

  it('finds nothing rather than everything when a customer search matches nobody', () => {
    const search = configure(true, false);
    let groups: readonly unknown[] = [];

    search.search('nobody').subscribe((result) => (groups = result));

    http.expectOne(`${BASE}/superadmin/admins`).flush({
      data: [{ id: 'adm_1', organisation: 'Metro', name: 'Ali', email: 'ali@metro.pk' }],
    });

    expect(groups).toEqual([]);
  });
});
