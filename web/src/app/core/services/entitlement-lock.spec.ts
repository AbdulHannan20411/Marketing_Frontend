import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { EntitlementService } from './entitlement.service';

/**
 * A workspace with no plan had full use of the product — contacts, imports,
 * campaigns, everything. These pin the four states that lock and, just as
 * importantly, the two that must not.
 */
describe('EntitlementService — the lock', () => {
  let entitlements: EntitlementService;
  let http: HttpTestingController;

  function load(body: unknown, status = 200, errorCode?: string): void {
    entitlements.load();
    const request = http.expectOne((candidate) => candidate.url.includes('/entitlements'));
    if (status === 200) {
      request.flush({ data: body });
    } else {
      request.flush(
        { message: 'nope', errorCode, detail: 'This organisation has no subscription.' },
        { status, statusText: 'Server Error' },
      );
    }
  }

  function snapshot(subscriptionStatus: string | null) {
    return subscriptionStatus === null
      ? null
      : {
          planId: 'plan_1',
          planName: 'Growth',
          status: subscriptionStatus,
          expiresAt: '2027-01-01T00:00:00Z',
          trialEndsAt: null,
          modules: {},
          limits: {},
          usage: [],
        };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isSuperAdmin: signal(false) } },
        { provide: AdminScopeService, useValue: { selectedId: signal(null) } },
      ],
    });
    entitlements = TestBed.inject(EntitlementService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('locks a workspace that has never bought a plan', () => {
    load(snapshot(null));

    expect(entitlements.isLocked()).toBeTrue();
    expect(entitlements.lockReason()).toBe('none');
  });

  it('locks an expired, suspended or cancelled subscription', () => {
    for (const status of ['expired', 'suspended', 'cancelled']) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: AuthService, useValue: { isSuperAdmin: signal(false) } },
          { provide: AdminScopeService, useValue: { selectedId: signal(null) } },
        ],
      });
      entitlements = TestBed.inject(EntitlementService);
      http = TestBed.inject(HttpTestingController);

      load(snapshot(status));

      expect(entitlements.lockReason()).withContext(status).toBe(status as 'expired');
    }
  });

  it('leaves an active or trialling workspace alone', () => {
    load(snapshot('active'));

    expect(entitlements.isLocked()).toBeFalse();
    expect(entitlements.lockReason()).toBeNull();
  });

  it('locks when the API says there is no subscription', () => {
    // `GET /subscription/entitlements` answers 404 for a workspace that never
    // bought a plan — which `HttpClient` reports as an error like any other.
    // Treating it as a failure is what let a brand-new workspace add contacts,
    // import them, create tags and reach the WhatsApp connection.
    load(null, 404);

    expect(entitlements.isLocked()).toBeTrue();
    expect(entitlements.lockReason()).toBe('none');
  });

  it('locks on the named reason, whatever the status', () => {
    // The API names it now — `no_subscription` — which is what tells this
    // apart from a 404 caused by a renamed path or a version bump.
    load(null, 404, 'no_subscription');

    expect(entitlements.lockReason()).toBe('none');
    expect(entitlements.hasFeature('crm')).toBeFalse();
  });

  it('locks a 200 that carries no status', () => {
    // The backend served `status: null` for a workspace with no plan for a
    // while and has said it could again. Read strictly, that is neither a 404
    // nor one of the four locking statuses — so it would have unlocked the one
    // workspace that must stay locked.
    load({
      planId: null,
      planName: null,
      status: null,
      expiresAt: null,
      trialEndsAt: null,
      modules: {},
      limits: {},
      usage: [],
    });

    expect(entitlements.isLocked()).toBeTrue();
    expect(entitlements.lockReason()).toBe('none');
  });

  it('grants no modules without a plan', () => {
    load(null, 404);

    expect(entitlements.hasFeature('crm')).toBeFalse();
    expect(entitlements.hasFeature('whatsapp')).toBeFalse();
    expect(entitlements.hasFeature('reporting')).toBeFalse();
  });

  it('keeps every module while the answer is unknown', () => {
    // A 500 is not a verdict. Hiding the product over a dropped request would
    // be a worse bug than the one above.
    load(null, 500);

    expect(entitlements.hasFeature('crm')).toBeTrue();
  });

  it('does not lock when the request failed', () => {
    // "The API did not answer" is not "there is no plan". Locking a paying
    // customer out over a dropped request is worse than the bug being fixed.
    load(null, 500);

    expect(entitlements.isLocked()).toBeFalse();
  });

  it('does not lock before the answer arrives', () => {
    expect(entitlements.isLocked()).toBeFalse();
  });
});
