import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { AuthUser, Permission } from '@core/models/auth.model';
import { AuthService } from './auth.service';

/**
 * The safety property of "view as a teammate": it narrows and never widens.
 *
 * A preview that could grant a permission would be a way to click into
 * something the account is not allowed to do — the opposite of what it is for.
 */
describe('AuthService — viewing as a teammate', () => {
  let auth: AuthService;

  const ADMIN_PERMISSIONS: readonly Permission[] = [
    'contacts.view',
    'contacts.edit',
    'settings.employees',
  ];

  function signIn(permissions: readonly Permission[]): void {
    const user: AuthUser = {
      id: 'emp_1',
      name: 'Honey',
      initials: 'H',
      email: 'admin@nextreach.io',
      role: 'Admin',
      isSuperAdmin: false,
      permissions,
    } as AuthUser;

    // The session is private state; this is the seam the app fills on sign-in.
    (auth as unknown as { currentUser: { set: (value: AuthUser) => void } }).currentUser.set(user);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    auth = TestBed.inject(AuthService);
    signIn(ADMIN_PERMISSIONS);
  });

  it('hides what the teammate cannot do', () => {
    expect(auth.hasPermission('settings.employees')).toBeTrue();

    auth.viewAs({
      id: 'emp_2',
      name: 'Ayesha',
      initials: 'A',
      role: 'Employee',
      jobTitle: 'Agent',
      permissions: ['contacts.view'],
    });

    expect(auth.hasPermission('contacts.view')).toBeTrue();
    expect(auth.hasPermission('settings.employees')).toBeFalse();
    expect(auth.hasPermission('contacts.edit')).toBeFalse();
  });

  it('cannot grant a permission the account does not hold', () => {
    // The teammate's list is not the source of truth — the intersection is.
    auth.viewAs({
      id: 'emp_2',
      name: 'Ayesha',
      initials: 'A',
      role: 'Employee',
      jobTitle: 'Agent',
      permissions: ['platform.tenants' as Permission, 'contacts.view'],
    });

    expect(auth.hasPermission('platform.tenants' as Permission)).toBeFalse();
  });

  it('gives the admin their own view back', () => {
    auth.viewAs({
      id: 'emp_2',
      name: 'Ayesha',
      initials: 'A',
      role: 'Employee',
      jobTitle: 'Agent',
      permissions: ['contacts.view'],
    });
    auth.stopViewingAs();

    expect(auth.viewingAs()).toBeNull();
    expect(auth.hasPermission('settings.employees')).toBeTrue();
  });

  it('does not survive signing out', () => {
    auth.viewAs({
      id: 'emp_2',
      name: 'Ayesha',
      initials: 'A',
      role: 'Employee',
      jobTitle: 'Agent',
      permissions: ['contacts.view'],
    });

    auth.discardSession();

    expect(auth.viewingAs()).toBeNull();
  });
});
