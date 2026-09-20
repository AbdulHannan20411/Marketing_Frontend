import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationError,
  Router,
  provideRouter,
  withComponentInputBinding,
  type Event as RouterEvent,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom } from 'rxjs';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { authTokenInterceptor } from '@core/interceptors/auth-token.interceptor';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { mockBackendInterceptor } from '@core/mock/mock-backend.interceptor';
import { scopeInterceptor } from '@core/scope/scope.interceptor';
import { routes } from './app.routes';

/**
 * A Super Admin clicking Security must land on it. Runs the real route table,
 * guards and shell against the in-memory API, and records any navigation that
 * is cancelled or fails on the way — which is otherwise silent in the browser.
 */
describe('Super Admin navigation to Security', () => {
  const env = environment as { useMockApi: boolean };
  let previous: boolean;

  beforeEach(() => {
    previous = env.useMockApi;
    env.useMockApi = true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(
          withInterceptors([errorInterceptor, authTokenInterceptor, scopeInterceptor, mockBackendInterceptor]),
        ),
      ],
    });
  });

  afterEach(() => {
    env.useMockApi = previous;
  });

  async function signInAsSuperAdmin(): Promise<void> {
    // The documented demo account of the in-memory API; no real service is involved.
    await firstValueFrom(
      TestBed.inject(AuthService).login({
        email: 'superadmin@nextreach.io',
        password: 'Password1!',
        rememberMe: false,
        portal: 'superadmin',
      }),
    );
  }

  function trackFailures(): string[] {
    const failures: string[] = [];
    TestBed.inject(Router).events.subscribe((event: RouterEvent) => {
      if (event instanceof NavigationCancel) {
        failures.push(`cancel ${event.url}: ${event.reason}`);
      } else if (event instanceof NavigationError) {
        failures.push(`error ${event.url}: ${String(event.error)}`);
      }
    });
    return failures;
  }

  for (const target of ['/superadmin/security', '/superadmin/tenants/tnt_001/security', '/account/security']) {
    it(`reaches ${target}`, async () => {
      await signInAsSuperAdmin();
      // Let the profile and entitlement calls that sign-in kicks off settle, so
      // a late one cannot cancel the navigation under test.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const failures = trackFailures();
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/superadmin/dashboard');
      await harness.navigateByUrl(target);

      expect(failures).withContext(failures.join('\n')).toEqual([]);
      expect(TestBed.inject(Router).url).toBe(target);
    });
  }
});
