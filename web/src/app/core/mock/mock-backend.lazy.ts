import type { HttpInterceptorFn } from '@angular/common/http';
import { from, switchMap } from 'rxjs';

/**
 * The mock backend, fetched the first time a request passes through it.
 *
 * Importing `mock-backend.interceptor` directly from the app config put the
 * whole seeded dataset — the interceptor, the fixtures, every handler, around
 * 100 KB — into `main.js` of **every** build, production included, because the
 * bundler cannot drop a module that the config's interceptor list mentions.
 *
 * Behind a dynamic `import()` it is only ever downloaded when
 * `environment.useMockApi` put this interceptor in the chain. The module is
 * cached after the first request, so only that one waits a tick for it.
 */
export const lazyMockBackendInterceptor: HttpInterceptorFn = (request, next) =>
  from(import('./mock-backend.interceptor')).pipe(
    switchMap((module) => module.mockBackendInterceptor(request, next)),
  );
