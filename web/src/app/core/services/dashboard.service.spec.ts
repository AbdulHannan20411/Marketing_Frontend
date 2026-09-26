import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '@env/environment';
import { DashboardService } from './dashboard.service';

/**
 * The export and the table are composed from one allow-list on the server, so
 * the only way they can come out in different orders is if the client asks
 * them for different things.
 */
describe('DashboardService — failure log', () => {
  let dashboard: DashboardService;
  let http: HttpTestingController;

  const BASE = environment.apiBaseUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    dashboard = TestBed.inject(DashboardService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks the export for the same order as the table', () => {
    dashboard.getFailures(1, 10, 'errorCode', 'desc').subscribe();
    const list = http.expectOne((request) => request.url === `${BASE}/reports/failures`);

    dashboard.exportFailures('errorCode', 'desc').subscribe();
    const download = http.expectOne(
      (request) => request.url === `${BASE}/reports/failures/export`,
    );

    expect(download.request.params.get('sortBy')).toBe(list.request.params.get('sortBy'));
    expect(download.request.params.get('sortDirection')).toBe(
      list.request.params.get('sortDirection'),
    );
    expect(download.request.params.get('sortBy')).toBe('errorCode');
    expect(download.request.params.get('sortDirection')).toBe('descending');

    list.flush({ data: { items: [], totalItems: 0, page: 1, pageSize: 10 } });
    download.flush(new Blob(['recipient,reason\n']));
  });

  it('sends no sort from an unsorted table, so the file keeps the API default', () => {
    dashboard.exportFailures().subscribe();

    const download = http.expectOne(
      (request) => request.url === `${BASE}/reports/failures/export`,
    );
    expect(download.request.params.has('sortBy')).toBeFalse();
    expect(download.request.params.has('sortDirection')).toBeFalse();

    download.flush(new Blob(['recipient,reason\n']));
  });
});
