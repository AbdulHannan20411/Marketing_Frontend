import { employeeIdOf, isSamePerson } from './employee.model';

/**
 * The session knows the signed-in user as `12` (the token's subject); the API
 * names assignees `emp_12`. Compared raw, "assigned to you" never matched.
 */
describe('employee ids', () => {
  it('turns a bare user id into the employee form', () => {
    expect(employeeIdOf('12')).toBe('emp_12');
  });

  it('accepts the usr_ and emp_ forms', () => {
    expect(employeeIdOf('usr_12')).toBe('emp_12');
    expect(employeeIdOf('emp_12')).toBe('emp_12');
  });

  it('matches the same person across forms, and nobody when an id is missing', () => {
    expect(isSamePerson('12', 'emp_12')).toBeTrue();
    expect(isSamePerson('usr_12', 'emp_12')).toBeTrue();
    expect(isSamePerson('12', 'emp_13')).toBeFalse();
    expect(isSamePerson(null, 'emp_12')).toBeFalse();
    expect(isSamePerson(undefined, undefined)).toBeFalse();
  });
});
