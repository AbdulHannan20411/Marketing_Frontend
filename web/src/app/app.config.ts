import { type ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';

import { authTokenInterceptor } from '@core/interceptors/auth-token.interceptor';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { mockBackendInterceptor } from '@core/mock/mock-backend.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    // Order matters: error normalisation wraps the token retry, and the mock
    // backend sits innermost so it short-circuits before hitting the network.
    provideHttpClient(
      withInterceptors([errorInterceptor, authTokenInterceptor, mockBackendInterceptor]),
    ),
  ],
};
