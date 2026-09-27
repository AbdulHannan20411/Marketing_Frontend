import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../environments/environment';
import { SecurityIndexComponent } from './security-index.component';

/** The platform Security page must render — a failure here cancels the navigation to it. */
describe('SecurityIndexComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SecurityIndexComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('draws the whole screen from one paged request', () => {
    const fixture = TestBed.createComponent(SecurityIndexComponent);
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);

    /*
     * One request, carrying the page. Three faults this pins, all of them
     * reported:
     *
     * - the screen used to read **every** admin account and page them here;
     * - it then asked each workspace for its own overview, one request per
     *   row, so ten rows on screen cost eleven requests;
     * - and asking for a sort the admins endpoint cannot do made the client
     *   drop `page` entirely and fetch the lot by another route.
     */
    const request = http.expectOne(
      (candidate) => candidate.url === `${environment.apiBaseUrl}/superadmin/security/summary`,
    );

    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('10');

    request.flush({
      data: {
        items: [
          {
            tenantId: 'tnt_1',
            organizationName: 'Glow Studio',
            people: 14,
            activeSessions: 9,
            highRisk: 2,
            mediumRisk: 1,
            needsAttention: 3,
          },
        ],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      },
      message: null,
      traceId: null,
    });
    fixture.detectChanges();

    // Nothing else is asked for: the counts came with the row.
    http.verify();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Glow Studio');
    expect(text).toContain('2 high risk');
  });
});
