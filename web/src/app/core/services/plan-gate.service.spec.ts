import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { EntitlementService } from './entitlement.service';
import { PlanGateService } from './plan-gate.service';

/**
 * The product rule this encodes: every screen is readable, and the plan is
 * enforced on the actions. So what matters is that an action is stopped for
 * the right reason — "purchase" and "upgrade" are different sentences to
 * somebody who is already paying.
 */
describe('PlanGateService', () => {
  function configure(options: {
    unrestricted?: boolean;
    locked?: boolean;
    modules?: readonly string[];
  }): PlanGateService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EntitlementService,
          useValue: {
            isUnrestricted: signal(options.unrestricted ?? false),
            isLocked: signal(options.locked ?? false),
            hasFeature: (module: string) => (options.modules ?? []).includes(module),
            lockReason: signal(options.locked ? 'none' : null),
            planName: signal('Growth'),
          },
        },
      ],
    });
    return TestBed.inject(PlanGateService);
  }

  it('lets an entitled action through without a prompt', () => {
    const gate = configure({ modules: ['crm'] });

    expect(gate.allow({ action: 'Creating a tag', module: 'crm' })).toBeTrue();
    expect(gate.prompt()).toBeNull();
  });

  it('asks for an upgrade when the module is there but the part is not', () => {
    // Nearby-business search sits inside CRM, and a plan can carry CRM with a
    // zero radius. `hasFeature('crm')` is true and the search still is not
    // sold, so the two questions are asked separately.
    const gate = configure({ modules: ['crm'] });

    expect(
      gate.allow({ action: 'Importing business contacts', module: 'crm', included: false }),
    ).toBeFalse();
    expect(gate.prompt()?.reason).toBe('upgrade');
  });

  it('asks a workspace with no plan to purchase, not to upgrade', () => {
    // `included` must not outrank the lock: somebody who has bought nothing
    // cannot upgrade, and telling them to would lead nowhere.
    const gate = configure({ locked: true, modules: ['crm'] });

    expect(
      gate.allow({ action: 'Importing business contacts', module: 'crm', included: false }),
    ).toBeFalse();
    expect(gate.prompt()?.reason).toBe('purchase');
  });

  it('asks a workspace with no usable plan to purchase one', () => {
    const gate = configure({ locked: true, modules: ['crm'] });

    expect(gate.allow({ action: 'Creating a tag', module: 'crm' })).toBeFalse();
    expect(gate.prompt()?.reason).toBe('purchase');
    expect(gate.prompt()?.action).toBe('Creating a tag');
  });

  it('asks a paying workspace to upgrade, not to purchase', () => {
    // Telling somebody who already pays to "buy a plan" reads as though their
    // money went nowhere.
    const gate = configure({ modules: ['crm'] });

    expect(gate.allow({ action: 'Creating a campaign', module: 'whatsapp' })).toBeFalse();
    expect(gate.prompt()?.reason).toBe('upgrade');
    expect(gate.prompt()?.module).toBe('whatsapp');
  });

  it('stops an action with no module of its own only when the plan is unusable', () => {
    // Inviting a teammate belongs to every plan, so it is gated by the lock
    // alone.
    expect(configure({ modules: [] }).allow({ action: 'Inviting a teammate' })).toBeTrue();
    expect(configure({ locked: true }).allow({ action: 'Inviting a teammate' })).toBeFalse();
  });

  it('never stops platform staff', () => {
    const gate = configure({ unrestricted: true, locked: true, modules: [] });

    expect(gate.allow({ action: 'Creating a campaign', module: 'whatsapp' })).toBeTrue();
  });

  it('closes on dismiss, so the next action starts clean', () => {
    const gate = configure({ locked: true });

    gate.allow({ action: 'Creating a tag', module: 'crm' });
    gate.dismiss();

    expect(gate.prompt()).toBeNull();
  });

  it('turns the API refusal into the same offer', () => {
    const gate = configure({ locked: true });

    gate.promptPurchase('Saving a contact');

    expect(gate.prompt()?.reason).toBe('purchase');
    expect(gate.prompt()?.action).toBe('Saving a contact');
  });
});
