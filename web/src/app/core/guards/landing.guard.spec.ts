import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, type UrlTree } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { LayoutService } from '@core/services/layout.service';
import { landingGuard } from './landing.guard';

/**
 * The case this exists for: an employee invited with no permissions was sent to
 * `/dashboard` — a screen they had no right to, whose endpoints answered 403.
 * The first thing they ever saw of the product was a page of errors.
 */
describe('landingGuard', () => {
  function run(routes: readonly string[], isSuperAdmin = false): string {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isSuperAdmin: () => isSuperAdmin } },
        {
          provide: LayoutService,
          useValue: {
            visibleNavigation: signal(
              routes.length === 0 ? [] : [{ items: routes.map((route) => ({ route })) }],
            ),
          },
        },
      ],
    });

    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(
      () => landingGuard({ data: {} } as never, {} as never) as UrlTree,
    );
    return router.serializeUrl(result);
  }

  it('sends an employee with no permissions somewhere that explains, not to a 403 wall', () => {
    expect(run([])).toBe('/forbidden');
  });

  it('sends a WhatsApp-only employee straight to WhatsApp', () => {
    expect(run(['/whatsapp'])).toBe('/whatsapp');
  });

  it('sends a contacts-only employee to Contacts rather than the dashboard', () => {
    expect(run(['/contacts', '/groups'])).toBe('/contacts');
  });

  it('sends a full-access admin to the dashboard, as before', () => {
    expect(run(['/dashboard', '/contacts', '/whatsapp'])).toBe('/dashboard');
  });

  it('keeps Super Admins in their own portal', () => {
    expect(run(['/dashboard'], true)).toBe('/superadmin/dashboard');
  });
});
