import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';

import { AuthService } from '@core/auth/auth.service';
import { GENERAL_TOUR_ID } from '@core/config/tours.config';
import { INITIAL_ONBOARDING_STATE, type OnboardingState } from '@core/models/onboarding.model';
import { EntitlementService } from './entitlement.service';
import { LayoutService } from './layout.service';
import { OnboardingService } from './onboarding.service';
import { OnboardingStoreService } from './onboarding-store.service';

/**
 * The rules worth pinning are the ones a future change could quietly break:
 * that only one tour runs at a time, that a module tour never writes to the
 * "already onboarded" record, and that unreachable sections produce no steps.
 */
describe('OnboardingService', () => {
  let stored: OnboardingState;
  let setStatus: jasmine.Spy;
  let navigation: ReturnType<typeof signal<{ items: { route: string }[] }[]>>;

  /** Every route the app has, so nothing is filtered out by default. */
  const ALL_ROUTES = [
    '/dashboard',
    '/contacts',
    '/groups',
    '/whatsapp',
    '/templates',
    '/campaigns',
    '/inbox',
    '/reports',
    '/employees',
    '/settings',
  ];

  function configure(routes: readonly string[] = ALL_ROUTES): OnboardingService {
    stored = { ...INITIAL_ONBOARDING_STATE };
    setStatus = jasmine.createSpy('setOnboardingStatus').and.returnValue(of(stored));
    navigation = signal([{ items: routes.map((route) => ({ route })) }]);

    TestBed.configureTestingModule({
      providers: [
        OnboardingService,
        {
          provide: OnboardingStoreService,
          useValue: {
            getOnboardingStatus: () => of(stored),
            setOnboardingStatus: setStatus,
            resetOnboarding: () => of(INITIAL_ONBOARDING_STATE),
          },
        },
        {
          provide: AuthService,
          useValue: { user: signal({ id: 'u1', isSuperAdmin: false }) },
        },
        {
          provide: LayoutService,
          useValue: {
            visibleNavigation: navigation,
            openMobileNav: () => undefined,
            closeMobileNav: () => undefined,
          },
        },
        { provide: EntitlementService, useValue: { isLocked: () => false } },
        {
          provide: Router,
          useValue: { url: '/dashboard', navigateByUrl: () => Promise.resolve(true) },
        },
      ],
    });

    return TestBed.inject(OnboardingService);
  }

  it('loads the general tour by default', () => {
    const service = configure();
    expect(service.activeTour()?.id).toBe(GENERAL_TOUR_ID);
    expect(service.total()).toBeGreaterThan(0);
  });

  it('offers only module tours whose section the user can reach', () => {
    const service = configure(['/dashboard', '/whatsapp', '/templates']);
    const offered = service.availableModuleTours().map((tour) => tour.module);

    expect(offered).toContain('whatsapp');
    expect(offered).toContain('templates');
    // No /contacts and no /campaigns in the sidebar, so neither is offered.
    expect(offered).not.toContain('contacts');
    expect(offered).not.toContain('campaigns');
  });

  it('offers no module tours at all when the sidebar is empty', () => {
    const service = configure([]);
    expect(service.availableModuleTours()).toEqual([]);
    expect(service.total()).toBe(0);
  });

  it('drops steps for routes the user cannot reach', () => {
    const service = configure(['/dashboard', '/settings']);
    const routes = service.steps().map((step) => step.route);

    expect(routes).toEqual(['/dashboard', '/settings']);
    expect(service.total()).toBe(2);
  });

  it('switching tours replaces the running one rather than stacking', () => {
    const service = configure();

    service.startTour('whatsapp-tour');
    expect(service.activeTour()?.id).toBe('whatsapp-tour');

    service.startTour('contacts-tour');
    expect(service.activeTour()?.id).toBe('contacts-tour');
    // One runner, so one set of steps — there is nowhere for a second overlay
    // to come from.
    expect(service.steps().every((step) => step.route !== '/whatsapp')).toBeTrue();
  });

  it('ignores a tour id that is not registered', () => {
    const service = configure();
    service.startTour('does-not-exist');

    expect(service.active()).toBeFalse();
    expect(service.activeTour()?.id).toBe(GENERAL_TOUR_ID);
  });

  it('does not record onboarding state for a module tour', () => {
    const service = configure();
    setStatus.calls.reset();

    service.startTour('whatsapp-tour');
    service.complete();

    // Writing here would tell the app this user has had their first-login
    // walkthrough, and suppress the general tour they never saw.
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('records onboarding state for the general tour', () => {
    const service = configure();
    setStatus.calls.reset();

    service.complete();

    expect(setStatus).toHaveBeenCalled();
    expect(setStatus.calls.mostRecent().args[1]).toBe('completed');
  });

  it('resolves the target selector from the step, not the route', () => {
    const service = configure();
    service.startTour('whatsapp-tour');

    const step = service.currentStep();
    expect(step).not.toBeNull();
    expect(service.currentSelector()).toBe(`[data-tour="${step!.target}"]`);
  });

  it('defaults a step with no explicit target to its route', () => {
    const service = configure();
    // The general tour points at sidebar links, whose data-tour is the route.
    for (const step of service.steps()) {
      expect(step.target).toBe(step.route);
    }
  });

  /* ------------------- state-dependent steps ------------------- */

  /**
   * The bug this pins: a WhatsApp tour on a *disconnected* workspace counted
   * all ten steps, then jumped "Step 3 of 10" straight to "Step 8 of 10" as it
   * skipped the five that only exist once connected. Users read that as the
   * tour advancing by itself.
   */
  describe('steps whose target is not on the page', () => {
    function paint(targets: readonly string[]): void {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="tour-fixture" data-tour-ready>${targets
          .map((t) => `<div data-tour="${t}" style="width:40px;height:10px"></div>`)
          .join('')}</div>`,
      );
    }

    afterEach(() => document.getElementById('tour-fixture')?.remove());

    it('drops connected-only steps on a disconnected workspace', async () => {
      const service = configure();
      // What the WhatsApp page actually renders before anything is connected.
      paint(['/whatsapp', 'whatsapp.preflight', 'whatsapp.connect', 'templates.new', 'campaigns.new']);

      service.startTour('whatsapp-tour');
      await new Promise((r) => setTimeout(r, 400));

      const targets = service.steps().map((step) => step.target);
      expect(targets).toContain('whatsapp.preflight');
      expect(targets).toContain('whatsapp.connect');
      expect(targets).not.toContain('whatsapp.status');
      expect(targets).not.toContain('whatsapp.namespace');
      // The count must match what the user will actually be walked through.
      expect(service.total()).toBe(targets.length);
    });

    it('drops disconnected-only steps on a connected workspace', async () => {
      const service = configure();
      paint([
        '/whatsapp',
        'whatsapp.status',
        'whatsapp.limit',
        'whatsapp.namespace',
        'whatsapp.refresh',
        'templates.new',
        'campaigns.new',
      ]);

      service.startTour('whatsapp-tour');
      await new Promise((r) => setTimeout(r, 400));

      const targets = service.steps().map((step) => step.target);
      expect(targets).toContain('whatsapp.status');
      expect(targets).not.toContain('whatsapp.connect');
      expect(targets).not.toContain('whatsapp.preflight');
    });

    it('treats a zero-width but visible element as present', async () => {
      const service = configure();
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="tour-fixture" data-tour-ready>
           <div data-tour="/whatsapp" style="width:0;height:24px"></div>
           <div data-tour="whatsapp.preflight" style="width:0;height:24px"></div>
         </div>`,
      );

      service.startTour('whatsapp-tour');
      await new Promise((r) => setTimeout(r, 400));

      // A full-width block measures zero width in a collapsed viewport. Reading
      // that as "absent" silently skipped real steps.
      expect(service.steps().map((step) => step.target)).toContain('whatsapp.preflight');
    });
  });

  /* ------------------- first-login tour selection ------------------- */

  /**
   * An employee granted one module reaches one section, so the general tour
   * filters down to a single step naming the thing they can already see. The
   * module's own tour is the one that teaches them anything.
   */
  describe('which tour a first sign-in gets', () => {
    it('gives a WhatsApp-only employee the WhatsApp tour', () => {
      const service = configure(['/whatsapp']);
      service.maybeStartForFirstLogin();

      expect(service.activeTour()?.id).toBe('whatsapp-tour');
      expect(service.total()).toBeGreaterThan(1);
    });

    it('gives a contacts-only employee the Contacts tour', () => {
      const service = configure(['/contacts']);
      service.maybeStartForFirstLogin();

      expect(service.activeTour()?.id).toBe('contacts-tour');
    });

    it('keeps the general tour when several sections are reachable', () => {
      const service = configure(['/dashboard', '/contacts', '/whatsapp', '/campaigns']);
      service.maybeStartForFirstLogin();

      // With more than one section the map is the useful thing; a deep tour of
      // one of them would leave the rest unexplained.
      expect(service.activeTour()?.id).toBe(GENERAL_TOUR_ID);
    });

    it('falls back to the general tour when no module tour fits', () => {
      // Reports and Settings have no module tours of their own.
      const service = configure(['/reports', '/settings']);
      service.maybeStartForFirstLogin();

      expect(service.activeTour()?.id).toBe(GENERAL_TOUR_ID);
    });

    it('records onboarding when a module tour served as the introduction', () => {
      const service = configure(['/whatsapp']);
      setStatus.calls.reset();

      service.maybeStartForFirstLogin();
      service.complete();

      // Without this the WhatsApp tour reopens on every single login, because
      // module tours otherwise deliberately record nothing.
      expect(setStatus).toHaveBeenCalled();
      expect(setStatus.calls.mostRecent().args[1]).toBe('completed');
    });

    it('still records nothing for a module tour opened from Settings', () => {
      const service = configure(['/whatsapp']);
      setStatus.calls.reset();

      service.startTour('whatsapp-tour');
      service.complete();

      expect(setStatus).not.toHaveBeenCalled();
    });
  });

  /* ------------------- the permission floor ------------------- */

  /**
   * `Permissions.Baseline` grants `dashboard.view` to every invitee, so an
   * employee given nothing else still reaches one section. The general tour
   * then collapses to a single card naming the screen they are looking at.
   */
  describe('an employee with only the permission floor', () => {
    it('gets no tour at all rather than a one-step one', () => {
      const service = configure(['/dashboard']);
      service.maybeStartForFirstLogin();

      expect(service.active()).toBeFalse();
    });

    it('still gets the tour once a second section is reachable', () => {
      const service = configure(['/dashboard', '/contacts', '/whatsapp']);
      service.maybeStartForFirstLogin();

      expect(service.active()).toBeTrue();
    });
  });
});
