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
  withNavigationErrorHandler,
  withViewTransitions,
} from '@angular/router';

import { environment } from '@env/environment';
import { AppTitleStrategy } from '@core/config/title.strategy';
import { recoverFromStaleChunk } from '@core/config/stale-chunk-recovery';
import { authTokenInterceptor } from '@core/interceptors/auth-token.interceptor';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { lazyMockBackendInterceptor } from '@core/mock/mock-backend.lazy';
import { timeoutInterceptor } from '@core/interceptors/timeout.interceptor';
import { scopeInterceptor } from '@core/scope/scope.interceptor';
import { viewAsInterceptor } from '@core/scope/view-as.interceptor';
import { routes } from './app.routes';

/**
 * The mock backend is only in the chain when explicitly enabled, so a production
 * build never ships the seeded dataset.
 */
const interceptors = environment.useMockApi
  ? [
      errorInterceptor,
      authTokenInterceptor,
      scopeInterceptor,
      viewAsInterceptor,
      lazyMockBackendInterceptor,
    ]
  : [
      errorInterceptor,
      timeoutInterceptor,
      authTokenInterceptor,
      scopeInterceptor,
      // After the admin scope: a Super Admin previewing a teammate is scoped to
      // that workspace first, and both parameters go out together.
      viewAsInterceptor,
    ];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({
        /*
         * Swallow the rejection an interrupted transition produces.
         *
         * `document.startViewTransition` rejects `finished`, `ready` and
         * `updateCallbackDone` when a transition is abandoned — which happens
         * on any navigation that starts before the previous one has finished,
         * i.e. ordinary clicking around. Nothing awaits those promises, so
         * every interrupted navigation logged an uncaught
         * "Transition was aborted because of invalid state" to the console.
         * Not an error anyone can act on, and it buries the ones that are.
         */
        onViewTransitionCreated: ({ transition }) => {
          const ignore = (): void => undefined;
          void transition.finished.catch(ignore);
          void transition.ready.catch(ignore);
          void transition.updateCallbackDone.catch(ignore);
        },
      }),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      // A tab left open across a rebuild or deploy asks for page files that no
      // longer exist; reload to the page instead of silently doing nothing.
      withNavigationErrorHandler(recoverFromStaleChunk),
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
