import {
  canSuspendFrom,
  securityAlertLevel,
  suspendNeedsConfirmation,
  type SecurityEmployee,
} from './session-security.model';

function person(overrides: Partial<SecurityEmployee> = {}): SecurityEmployee {
  return {
    userId: 'emp_2',
    name: 'Sara Khan',
    email: 'sara@example.com',
    role: 'Employee',
    activeSessions: 1,
    devices: 1,
    lastActiveAt: null,
    displacedLast24Hours: 0,
    risk: null,
    ...overrides,
  };
}

describe('suspending from the security screen', () => {
  it('reads the level from the risk score when there is one', () => {
    expect(securityAlertLevel(person({ risk: { level: 'low', score: 5, reasons: [] } }))).toBe('low');
    expect(securityAlertLevel(person({ risk: { level: 'medium', score: 45, reasons: [] } }))).toBe('warning');
    expect(securityAlertLevel(person({ risk: { level: 'high', score: 80, reasons: [] } }))).toBe('high');
  });

  it('uses the alert thresholds on the workspace view, which has no score', () => {
    expect(securityAlertLevel(person())).toBe('low');
    expect(securityAlertLevel(person({ displacedLast24Hours: 3 }))).toBe('warning');
    expect(securityAlertLevel(person({ devices: 4 }))).toBe('warning');
  });

  it('asks for confirmation only at low risk', () => {
    expect(suspendNeedsConfirmation('low')).toBeTrue();
    expect(suspendNeedsConfirmation('warning')).toBeFalse();
    expect(suspendNeedsConfirmation('high')).toBeFalse();
  });

  it('never offers suspension for platform staff or yourself', () => {
    expect(canSuspendFrom(person({ role: 'SuperAdmin' }), 'platform', false)).toBeFalse();
    expect(canSuspendFrom(person({ role: 'Super Admin', canSuspend: true }), 'platform', false)).toBeFalse();
    expect(canSuspendFrom(person(), 'workspace', true)).toBeFalse();
  });

  it('lets a workspace suspend employees but not its admin; platform staff can do both', () => {
    expect(canSuspendFrom(person(), 'workspace', false)).toBeTrue();
    expect(canSuspendFrom(person({ role: 'Admin' }), 'workspace', false)).toBeFalse();
    expect(canSuspendFrom(person({ role: 'Admin' }), 'platform', false)).toBeTrue();
  });

  it('follows the server when it says', () => {
    expect(canSuspendFrom(person({ canSuspend: false }), 'workspace', false)).toBeFalse();
  });
});
