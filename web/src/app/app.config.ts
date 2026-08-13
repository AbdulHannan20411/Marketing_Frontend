import {
  inject,
  provideAppInitializer,
  type ApplicationConfig,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '@core/auth/auth.service';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';

import { environment } from '@env/environment';
import { AppTitleStrategy } from '@core/config/title.strategy';
import { authTokenInterceptor } from '@core/interceptors/auth-token.interceptor';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { mockBackendInterceptor } from '@core/mock/mock-backend.interceptor';
import { timeoutInterceptor } from '@core/interceptors/timeout.interceptor';
import { scopeInterceptor } from '@core/scope/scope.interceptor';
import { routes } from './app.routes';

/**
 * The mock backend is only in the chain when explicitly enabled, so a production
 * build never ships the seeded dataset.
 */
const interceptors = environment.useMockApi
  ? [errorInterceptor, authTokenInterceptor, scopeInterceptor, mockBackendInterceptor]
  : [errorInterceptor, timeoutInterceptor, authTokenInterceptor, scopeInterceptor];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    // Order matters: error normalisation wraps the token retry, and the scope
    // parameter is applied last so it lands on the outgoing request.
    provideHttpClient(withInterceptors(interceptors)),

    // Routes carry the page name only; the product name is appended here.
    { provide: TitleStrategy, useClass: AppTitleStrategy },

    // The profile lives behind `GET /auth/me`, so a stored token has to be
    // exchanged for a user before the first route guard runs — otherwise a
    // reload bounces an authenticated user back to the login screen.
    provideAppInitializer(() => firstValueFrom(inject(AuthService).restoreSession())),
  ],
};
