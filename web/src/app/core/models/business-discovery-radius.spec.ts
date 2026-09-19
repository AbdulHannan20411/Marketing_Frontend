import { RADIUS_OPTIONS_KM, effectiveRadius, radiusOptionsFor } from './business-discovery.model';

/** The radius dropdown follows the plan: a 5 km plan offers 1–5, a 10 km plan 1–10. */
describe('search radius by plan', () => {
  it('offers every whole kilometre up to the plan limit', () => {
    expect(radiusOptionsFor(3)).toEqual([1, 2, 3]);
    expect(radiusOptionsFor(5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never goes past the platform ceiling of 10 km', () => {
    expect(radiusOptionsFor(10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(radiusOptionsFor(25)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(radiusOptionsFor(null)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('offers nothing when the plan has no search, and the old list before limits are known', () => {
    expect(radiusOptionsFor(0)).toEqual([]);
    expect(radiusOptionsFor(undefined)).toEqual(RADIUS_OPTIONS_KM);
  });

  it('keeps an allowed choice and pulls a too-wide one down to the widest allowed', () => {
    expect(effectiveRadius(4, radiusOptionsFor(10))).toBe(4);
    expect(effectiveRadius(5, radiusOptionsFor(3))).toBe(3);
    expect(effectiveRadius(20, [1, 2, 5, 10])).toBe(10);
    expect(effectiveRadius(5, [])).toBe(0);
  });
});
