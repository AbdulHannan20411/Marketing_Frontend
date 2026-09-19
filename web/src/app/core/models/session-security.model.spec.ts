import { deviceId } from '@core/auth/device-id';
import {
  hasManyDevices,
  isFrequentlyDisplaced,
  sortForReview,
  type SecurityEmployee,
} from './session-security.model';

function person(overrides: Partial<SecurityEmployee>): SecurityEmployee {
  return {
    userId: 'u',
    name: 'Person',
    email: 'p@example.com',
    role: 'Employee',
    activeSessions: 0,
    devices: 1,
    lastActiveAt: null,
    displacedLast24Hours: 0,
    risk: null,
    ...overrides,
  };
}

describe('session security thresholds', () => {
  // The same thresholds the server alerts on: highlight exactly what it alerts about.
  it('highlights more than three devices', () => {
    expect(hasManyDevices({ devices: 3 })).toBeFalse();
    expect(hasManyDevices({ devices: 4 })).toBeTrue();
  });

  it('highlights three or more displacements in a day', () => {
    expect(isFrequentlyDisplaced({ displacedLast24Hours: 2 })).toBeFalse();
    expect(isFrequentlyDisplaced({ displacedLast24Hours: 3 })).toBeTrue();
  });
});

describe('sortForReview', () => {
  it('puts the riskiest first when there is a score', () => {
    const sorted = sortForReview([
      person({ userId: 'low', risk: { level: 'low', score: 5, reasons: [] } }),
      person({ userId: 'high', risk: { level: 'high', score: 80, reasons: [] } }),
      person({ userId: 'medium', risk: { level: 'medium', score: 40, reasons: [] } }),
    ]);
    expect(sorted.map((entry) => entry.userId)).toEqual(['high', 'medium', 'low']);
  });

  it('without scores, puts anyone over a threshold first, then by name', () => {
    const sorted = sortForReview([
      person({ userId: 'b', name: 'Bilal' }),
      person({ userId: 'shared', name: 'Zara', displacedLast24Hours: 4 }),
      person({ userId: 'a', name: 'Ali' }),
    ]);
    expect(sorted.map((entry) => entry.userId)).toEqual(['shared', 'a', 'b']);
  });
});

describe('deviceId', () => {
  afterEach(() => localStorage.removeItem('vd.device.id'));

  it('is stable across calls and in the format the API accepts', () => {
    const first = deviceId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(deviceId()).toBe(first);
  });

  it('replaces a stored value the API would reject', () => {
    localStorage.setItem('vd.device.id', 'has spaces and !');
    expect(deviceId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
