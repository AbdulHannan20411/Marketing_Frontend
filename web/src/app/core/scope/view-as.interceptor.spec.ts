import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { environment } from '@env/environment';
import { VIEW_AS_PARAM, viewAsInterceptor } from './view-as.interceptor';

/**
 * What the parameter must and must not be attached to. Each of these is a way
 * the preview could quietly become something other than a read of one
 * teammate's own records.
 */
describe('viewAsInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  const BASE = environment.apiBaseUrl;

  const SUBJECT = {
    id: 'emp_42',
    name: 'Ayesha',
    initials: 'A',
    role: 'Employee' as const,
    jobTitle: 'Agent',
    permissions: [],
  };

  function configure(options: { previewing: boolean; capable: boolean }): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([viewAsInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            viewingAs: signal(options.previewing ? SUBJECT : null),
            canViewAsData: signal(options.capable),
            isViewingData: signal(options.previewing && options.capable),
          },
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  }

  afterEach(() => backend.verify());

  it('attaches the teammate to a tenant-scoped read', () => {
    configure({ previewing: true, capable: true });

    http.get(`${BASE}/inbox/conversations`).subscribe();

    const request = backend.expectOne((candidate) => candidate.url === `${BASE}/inbox/conversations`);
    expect(request.request.params.get(VIEW_AS_PARAM)).toBe('emp_42');
    request.flush({});
  });

  it('never attaches it to a write', () => {
    // The API refuses a write carrying it. The client should not be relying on
    // that refusal — it simply does not ask.
    configure({ previewing: true, capable: true });

    http.post(`${BASE}/contacts`, {}).subscribe();

    const request = backend.expectOne((candidate) => candidate.url === `${BASE}/contacts`);
    expect(request.request.params.has(VIEW_AS_PARAM)).toBeFalse();
    request.flush({});
  });

  it('leaves the excluded routes alone', () => {
    configure({ previewing: true, capable: true });

    for (const path of ['/auth/me', '/superadmin/admins', '/admin/tenants', '/plans']) {
      http.get(`${BASE}${path}`).subscribe();
      const request = backend.expectOne((candidate) => candidate.url === `${BASE}${path}`);
      expect(request.request.params.has(VIEW_AS_PARAM))
        .withContext(path)
        .toBeFalse();
      request.flush({});
    }
  });

  it('matches by segment, so a longer path starting the same way is unaffected', () => {
    configure({ previewing: true, capable: true });

    // `/administrators` must not be caught by the `/admin` exclusion.
    http.get(`${BASE}/administrators`).subscribe();

    const request = backend.expectOne((candidate) => candidate.url === `${BASE}/administrators`);
    expect(request.request.params.get(VIEW_AS_PARAM)).toBe('emp_42');
    request.flush({});
  });

  it('sends nothing when the API cannot honour it', () => {
    // Sending it to an API without the capability would leave the banner
    // claiming to show somebody else's data while showing the caller's own.
    configure({ previewing: true, capable: false });

    http.get(`${BASE}/contacts`).subscribe();

    const request = backend.expectOne((candidate) => candidate.url === `${BASE}/contacts`);
    expect(request.request.params.has(VIEW_AS_PARAM)).toBeFalse();
    request.flush({});
  });

  it('sends nothing when nobody is being previewed', () => {
    configure({ previewing: false, capable: true });

    http.get(`${BASE}/contacts`).subscribe();

    const request = backend.expectOne((candidate) => candidate.url === `${BASE}/contacts`);
    expect(request.request.params.has(VIEW_AS_PARAM)).toBeFalse();
    request.flush({});
  });

  it('leaves requests to other hosts untouched', () => {
    configure({ previewing: true, capable: true });

    http.get('https://graph.facebook.com/v21.0/me').subscribe();

    const request = backend.expectOne('https://graph.facebook.com/v21.0/me');
    expect(request.request.params.has(VIEW_AS_PARAM)).toBeFalse();
    request.flush({});
  });
});
