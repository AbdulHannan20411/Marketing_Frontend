import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '@env/environment';
import { ApiService, toHttpParams } from './api.service';

/**
 * Pins how lists reach the API.
 *
 * ASP.NET binds `IReadOnlyList<string>` from repeated keys. A joined value binds
 * as one element — for the contacts export that was a single unparseable id,
 * which matched nothing and produced a header-only file with no error.
 */
describe('toHttpParams', () => {
  it('sends an array as repeated keys, not a joined string', () => {
    const params = toHttpParams({ ids: ['ctc_1', 'ctc_2', 'ctc_3'] });

    expect(params.getAll('ids')).toEqual(['ctc_1', 'ctc_2', 'ctc_3']);
    expect(params.toString()).toBe('ids=ctc_1&ids=ctc_2&ids=ctc_3');
  });

  it('omits an empty array entirely', () => {
    // `ids=` would bind as one empty element: a selection of no rows, which is
    // the opposite of "no selection".
    const params = toHttpParams({ ids: [], search: '' });

    expect(params.has('ids')).toBeFalse();
    expect(params.get('search')).toBe('');
  });

  it('still sends primitives as single values', () => {
    const params = toHttpParams({ page: 2, status: 'all', archived: false });

    expect(params.get('page')).toBe('2');
    expect(params.get('status')).toBe('all');
    expect(params.get('archived')).toBe('false');
  });

  it('keeps list values containing commas intact', () => {
    const params = toHttpParams({ groups: ['Barber · Gulberg, Lahore'] });
    expect(params.getAll('groups')).toEqual(['Barber · Gulberg, Lahore']);
  });
});

describe('ApiService envelopes', () => {
  let api: ApiService;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiService);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('unwraps the data of an envelope', () => {
    let result: unknown;
    api.get<{ id: string }>('/thing').subscribe((value) => (result = value));
    backend.expectOne(`${environment.apiBaseUrl}/thing`).flush({ data: { id: 'x' }, message: null, traceId: 't' });
    expect(result).toEqual({ id: 'x' });
  });

  it('treats a 204 with no body as success, not an error', () => {
    // The heartbeat and revoke endpoints answer this way; reading `.data` off
    // the empty body used to throw and report a successful call as failed.
    let succeeded = false;
    let failed = false;
    api.post<null>('/auth/heartbeat').subscribe({ next: () => (succeeded = true), error: () => (failed = true) });
    backend.expectOne(`${environment.apiBaseUrl}/auth/heartbeat`).flush(null, { status: 204, statusText: 'No Content' });
    expect(succeeded).toBeTrue();
    expect(failed).toBeFalse();
  });
});
