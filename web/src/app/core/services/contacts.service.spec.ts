import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '@env/environment';
import { ContactsService } from './contacts.service';

/**
 * The sort parameters are easy to get subtly wrong and impossible to notice:
 * a direction the server cannot bind does not fail, it quietly falls back to
 * the endpoint's default order.
 */
describe('ContactsService — list sorting', () => {
  let contacts: ContactsService;
  let http: HttpTestingController;

  const BASE = environment.apiBaseUrl;

  const query = {
    page: 1,
    pageSize: 10,
    search: '',
    status: 'all' as const,
    groupId: 'all',
    tagId: 'all',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    contacts = TestBed.inject(ContactsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends no sort parameters when no column is chosen', () => {
    contacts.list(query).subscribe();

    const request = http.expectOne((candidate) => candidate.url === `${BASE}/contacts`);
    expect(request.request.params.has('sortBy')).toBeFalse();
    expect(request.request.params.has('sortDirection')).toBeFalse();
    request.flush({ data: { items: [], totalItems: 0, page: 1, pageSize: 10 } });
  });

  it('spells the direction out in full, because the server binds an enum by name', () => {
    // `sortDirection=desc` does not bind to .NET's `SortDirection.Descending`,
    // and an unbound value is silently the default — an ascending list under a
    // header claiming to be descending.
    contacts.list({ ...query, sortBy: 'createdAt', sortDirection: 'desc' }).subscribe();

    const request = http.expectOne((candidate) => candidate.url === `${BASE}/contacts`);
    expect(request.request.params.get('sortBy')).toBe('createdAt');
    expect(request.request.params.get('sortDirection')).toBe('descending');
    request.flush({ data: { items: [], totalItems: 0, page: 1, pageSize: 10 } });
  });

  it('defaults to ascending when a column is chosen without a direction', () => {
    contacts.list({ ...query, sortBy: 'fullName' }).subscribe();

    const request = http.expectOne((candidate) => candidate.url === `${BASE}/contacts`);
    expect(request.request.params.get('sortDirection')).toBe('ascending');
    request.flush({ data: { items: [], totalItems: 0, page: 1, pageSize: 10 } });
  });
});
