import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { LayoutService } from './layout.service';

/**
 * The menu is the shop window.
 *
 * It used to drop every screen the plan did not cover, which left a new
 * workspace looking at a product with nothing in it and no reason to buy
 * anything. Permission still hides — that is a different kind of no.
 */
describe('LayoutService — navigation', () => {
  function configure(permissions: readonly string[]): LayoutService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            isSuperAdmin: signal(false),
            hasAnyPermission: (needed: readonly string[]) =>
              needed.length === 0 || needed.some((entry) => permissions.includes(entry)),
            hasRole: () => true,
          },
        },
        { provide: AdminScopeService, useValue: { isScoped: signal(false) } },
      ],
    });
    return TestBed.inject(LayoutService);
  }

  function routes(layout: LayoutService): readonly string[] {
    return layout.visibleNavigation().flatMap((section) => section.items.map((item) => item.route));
  }

  it('shows a screen whose module the plan does not cover', () => {
    // No entitlement service is even injected any more: the plan has no say
    // in what the menu lists.
    const layout = configure(['dashboard.view', 'contacts.view', 'whatsapp.campaigns.reports']);

    expect(routes(layout)).toContain('/contacts');
    expect(routes(layout)).toContain('/campaigns');
  });

  it('still hides what the person has no permission for', () => {
    const layout = configure(['dashboard.view']);

    expect(routes(layout)).toContain('/dashboard');
    expect(routes(layout)).not.toContain('/contacts');
  });
});
