import { GENERAL_TOUR_ID, GUIDED_TOURS, findTour } from './tours.config';

/**
 * Guards the registry's own invariants.
 *
 * These are the mistakes that are easy to make when adding a tour and invisible
 * until a user opens Settings: a duplicate id, a module tour with nothing to
 * gate it on, an entry with no steps. None of them throw — they just produce a
 * tour that silently does the wrong thing.
 */
describe('tours.config', () => {
  it('gives every tour a unique id', () => {
    const ids = GUIDED_TOURS.map((tour) => tour.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has exactly one general tour, and it is the one the service names', () => {
    const general = GUIDED_TOURS.filter((tour) => tour.type === 'general');
    expect(general.length).toBe(1);
    expect(general[0].id).toBe(GENERAL_TOUR_ID);
  });

  it('gates every module tour on a route, so it can be hidden when unreachable', () => {
    for (const tour of GUIDED_TOURS.filter((entry) => entry.type === 'module')) {
      expect(tour.requiresRoute)
        .withContext(`${tour.id} has no requiresRoute`)
        .toBeDefined();
      expect(tour.module).withContext(`${tour.id} has no module`).toBeDefined();
    }
  });

  it('never registers a tour with no steps', () => {
    for (const tour of GUIDED_TOURS) {
      expect(tour.steps.length).withContext(`${tour.id} has no steps`).toBeGreaterThan(0);
    }
  });

  it('gives every tour a title and description for the Settings list', () => {
    for (const tour of GUIDED_TOURS) {
      expect(tour.title.trim()).withContext(`${tour.id} title`).not.toBe('');
      expect(tour.description.trim()).withContext(`${tour.id} description`).not.toBe('');
    }
  });

  it('gives every step a route and copy', () => {
    for (const tour of GUIDED_TOURS) {
      for (const step of tour.steps) {
        expect(step.route.startsWith('/')).withContext(`${tour.id}: ${step.title}`).toBeTrue();
        expect(step.title.trim()).not.toBe('');
        expect(step.description.trim()).not.toBe('');
      }
    }
  });

  it('starts every module tour on the route it is gated on', () => {
    for (const tour of GUIDED_TOURS.filter((entry) => entry.type === 'module')) {
      expect(tour.steps[0].route)
        .withContext(`${tour.id} opens somewhere other than its own module`)
        .toBe(tour.requiresRoute!);
    }
  });

  it('finds a tour by id and returns null for one that does not exist', () => {
    expect(findTour(GENERAL_TOUR_ID)?.id).toBe(GENERAL_TOUR_ID);
    expect(findTour('no-such-tour')).toBeNull();
  });
});
