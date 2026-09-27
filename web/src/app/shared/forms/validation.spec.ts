import {
  FIELD_LIMITS,
  dateRangeError,
  emailError,
  firstError,
  isBlank,
  lengthError,
  minLengthError,
  numberError,
  numberRangeError,
} from './validation';

/**
 * The rules, and the sentences that explain them.
 *
 * A message is part of the behaviour here, not decoration: "Too long" leaves
 * somebody counting characters by hand, and "there is nothing here" for a
 * backwards date range sends them looking for missing data that was never
 * missing.
 */
describe('validation', () => {
  it('treats whitespace as empty', () => {
    // A field holding three spaces is empty to everybody except `length > 0`.
    expect(isBlank('   ')).toBeTrue();
    expect(isBlank('')).toBeTrue();
    expect(isBlank(null)).toBeTrue();
    expect(isBlank(' a ')).toBeFalse();
  });

  describe('lengths', () => {
    it('says how much to remove rather than that it is too long', () => {
      expect(lengthError('Name', 'a'.repeat(124), 120)).toBe(
        'Name cannot be longer than 120 characters. Remove 4.',
      );
    });

    it('passes a value exactly at the limit', () => {
      expect(lengthError('Name', 'a'.repeat(120), 120)).toBeNull();
    });

    it('does not demand a minimum of an empty field', () => {
      // Empty is "required"'s problem. Reporting both at once for one blank
      // field is two errors for one mistake.
      expect(minLengthError('Name', '', 2)).toBeNull();
      expect(minLengthError('Name', 'a', 2)).toBe('Name must be at least 2 characters.');
    });
  });

  describe('email', () => {
    it('catches the mistakes people actually make', () => {
      expect(emailError('Email', 'ayeshaexample.com')).toContain('missing @ or dot');
      expect(emailError('Email', 'ayesha@example')).toContain('missing @ or dot');
    });

    it('accepts the awkward addresses that are still valid', () => {
      // A strict pattern rejects real addresses, and the only true test of one
      // is whether mail arrives.
      expect(emailError('Email', "o'brien+tag@sub.example.co.uk")).toBeNull();
    });

    it('is silent on an empty optional field', () => {
      expect(emailError('Email', '  ')).toBeNull();
    });

    it('reports an over-long address as a length problem', () => {
      const long = `${'a'.repeat(FIELD_LIMITS.email)}@example.com`;
      expect(emailError('Email', long)).toContain('cannot be longer than');
    });
  });

  describe('numbers', () => {
    it('rejects what type="number" lets through', () => {
      // A pasted value and a locale comma both reach the handler.
      expect(numberError('Seats', 'twelve', {})).toBe('Seats must be a number.');
      expect(numberError('Seats', '1,5', {})).toBe('Seats must be a number.');
    });

    it('holds a count to whole numbers', () => {
      expect(numberError('Seats', 2.5, { integer: true })).toBe('Seats must be a whole number.');
      expect(numberError('Price', 2.5, {})).toBeNull();
    });

    it('names the bound it broke', () => {
      expect(numberError('Radius', 0, { min: 1, max: 10 })).toBe('Radius cannot be less than 1.');
      expect(numberError('Radius', 11, { min: 1, max: 10 })).toBe('Radius cannot be more than 10.');
      expect(numberError('Radius', 5, { min: 1, max: 10 })).toBeNull();
    });

    it('is silent on an empty field', () => {
      expect(numberError('Seats', null, { min: 1 })).toBeNull();
      expect(numberError('Seats', '', { min: 1 })).toBeNull();
    });
  });

  describe('ranges', () => {
    it('refuses a date range that runs backwards', () => {
      const message = dateRangeError('2026-09-20', '2026-09-01');

      expect(message).toContain('describes no period');
    });

    it('allows an open end at either side', () => {
      // Asking for "everything since August" is a legitimate range.
      expect(dateRangeError('2026-08-01', '')).toBeNull();
      expect(dateRangeError('', '2026-08-01')).toBeNull();
      expect(dateRangeError('', '')).toBeNull();
    });

    it('allows a single day', () => {
      expect(dateRangeError('2026-09-20', '2026-09-20')).toBeNull();
    });

    it('compares dates as text, which is safe for this format', () => {
      // `<input type="date">` is always YYYY-MM-DD whatever the locale, and
      // that sorts correctly — including across a year boundary.
      expect(dateRangeError('2026-12-31', '2027-01-01')).toBeNull();
      expect(dateRangeError('2027-01-01', '2026-12-31')).not.toBeNull();
    });

    it('refuses a numeric range that runs backwards', () => {
      expect(numberRangeError('Minimum', 10, 'maximum', 5)).toBe(
        'Minimum cannot be more than maximum.',
      );
      expect(numberRangeError('Minimum', 5, 'maximum', 10)).toBeNull();
      expect(numberRangeError('Minimum', null, 'maximum', 10)).toBeNull();
    });
  });

  it('reports one message at a time', () => {
    // Four errors on one field is a wall; the first thing to fix is enough.
    expect(firstError(null, 'second', 'third')).toBe('second');
    expect(firstError(null, null)).toBeNull();
  });
});
