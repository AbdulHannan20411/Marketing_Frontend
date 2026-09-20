import { HttpRequest, HttpResponse, type HttpEvent } from '@angular/common/http';
import { firstValueFrom, of, type Observable } from 'rxjs';

import { environment } from '@env/environment';
import { lazyMockBackendInterceptor } from './mock-backend.lazy';

/**
 * The mock backend is behind a dynamic import so it stays out of production
 * builds. That makes this wrapper the only way dev talks to it, so it is worth
 * proving that it loads the module and answers a seeded route.
 */
describe('lazyMockBackendInterceptor', () => {
  const env = environment as { useMockApi: boolean };
  let previous: boolean;

  beforeEach(() => {
    previous = env.useMockApi;
    env.useMockApi = true;
  });

  afterEach(() => {
    env.useMockApi = previous;
  });

  /** Stands in for the rest of the chain; only reached for paths the mock ignores. */
  const passthrough = (): Observable<HttpEvent<unknown>> => of(new HttpResponse({ status: 599 }));

  it('loads the mock and serves a seeded route', async () => {
    const request = new HttpRequest('GET', `${environment.apiBaseUrl}/plans`);

    const response = (await firstValueFrom(
      lazyMockBackendInterceptor(request, passthrough),
    )) as HttpResponse<{ data: readonly unknown[] }>;

    expect(response.status).toBe(200);
    expect(response.body?.data.length).toBeGreaterThan(0);
  });

  it('passes a non-API request down the chain', async () => {
    const request = new HttpRequest('GET', 'https://example.com/logo.png');

    const response = (await firstValueFrom(
      lazyMockBackendInterceptor(request, passthrough),
    )) as HttpResponse<unknown>;

    expect(response.status).toBe(599);
  });
});
