/**
 * The app's field limits and the sentences it uses to explain them.
 *
 * Two problems this solves. Limits were being written at the point of use, so
 * the same field was 100 characters on one screen and unbounded on another and
 * the API's own limit was a third number — which meant the only way to find out
 * was to type until a 422 came back. And the messages were written per form, so
 * the same mistake was "Required", "This field is required" and "Enter a name"
 * depending on where you made it.
 *
 * Every number here matches what the API enforces. When they disagree the API
 * wins and this is the bug.
 */

/** Longest each kind of field accepts, in characters. */
export const FIELD_LIMITS = {
  /** A person's or a record's name. */
  name: 120,
  /** A short line under a name. */
  description: 500,
  /** RFC 5321's limit, which is what the API validates against. */
  email: 254,
  /** Long enough for `+` and the longest E.164 number with separators. */
  phone: 32,
  /** A job title, a label, a plan tagline. */
  shortText: 80,
  /** A message body or a template. */
  body: 1024,
  /** A reason given to a customer, or a note. */
  note: 500,
  /** A URL. */
  url: 2048,
} as const;

/** Shortest values worth accepting, where a single character is meaningless. */
export const FIELD_MINIMUMS = {
  name: 2,
  /** The API refuses anything shorter as unhelpful to the customer. */
  rejectionReason: 10,
  password: 8,
} as const;

/**
 * Whether a value is present.
 *
 * Trimmed, because a field holding three spaces is empty to everybody except
 * `length > 0`.
 */
export function isBlank(value: string | null | undefined): boolean {
  return (value ?? '').trim() === '';
}

/** "Name is required." */
export function requiredError(label: string): string {
  return `${label} is required.`;
}

/**
 * A length error that says what to do, not what went wrong.
 *
 * "Name cannot be longer than 120 characters. Remove 4." beats "Too long":
 * the person can see the field, so what they need is the number to cut.
 */
export function lengthError(label: string, value: string, max: number): string | null {
  const length = value.trim().length;
  if (length <= max) {
    return null;
  }
  const over = length - max;
  return `${label} cannot be longer than ${max} characters. Remove ${over}.`;
}

/** A minimum-length error, for fields where one character is not an answer. */
export function minLengthError(label: string, value: string, min: number): string | null {
  const length = value.trim().length;
  if (length === 0 || length >= min) {
    return null;
  }
  return `${label} must be at least ${min} characters.`;
}

/**
 * An email that is plainly not one.
 *
 * Deliberately permissive: the real test of an address is whether mail arrives,
 * and a strict pattern rejects valid addresses — apostrophes, plus-addressing,
 * new top-level domains. This catches the mistakes people actually make, a
 * missing `@` or a missing dot, and leaves the rest to the API.
 */
export function emailError(label: string, value: string): string | null {
  const email = value.trim();
  if (email === '') {
    return null;
  }
  if (email.length > FIELD_LIMITS.email) {
    return lengthError(label, email, FIELD_LIMITS.email);
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? null
    : `${label} does not look like an email address. Check for a missing @ or dot.`;
}

/** What a number field will accept. */
export interface NumberRange {
  readonly min?: number;
  readonly max?: number;
  /** Whether fractions are allowed. Counts of things are not fractional. */
  readonly integer?: boolean;
}

/**
 * A number outside its range, or not a number at all.
 *
 * `type="number"` stops most of this in most browsers, but not all of it: a
 * pasted value, a locale that uses a comma, and Firefox's tolerance of `1e5`
 * all reach the handler. And `min`/`max` attributes do not stop a form being
 * submitted, they only mark it invalid — so the check has to exist here too.
 */
export function numberError(
  label: string,
  value: number | string | null,
  range: NumberRange,
): string | null {
  if (value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return `${label} must be a number.`;
  }
  if (range.integer === true && !Number.isInteger(parsed)) {
    return `${label} must be a whole number.`;
  }
  if (range.min !== undefined && parsed < range.min) {
    return `${label} cannot be less than ${range.min}.`;
  }
  if (range.max !== undefined && parsed > range.max) {
    return `${label} cannot be more than ${range.max}.`;
  }
  return null;
}

/**
 * A date range that runs backwards.
 *
 * The one every screen had and none of them checked: picking a From after a To
 * describes no period at all, so the list comes back empty and reads as "there
 * is nothing here" rather than "you have asked for nothing". Both ends are
 * optional — an open-ended range is a legitimate thing to ask for.
 *
 * Compared as strings because both come from `<input type="date">`, which is
 * always `YYYY-MM-DD` regardless of locale, and that sorts correctly.
 */
export function dateRangeError(from: string, to: string): string | null {
  if (isBlank(from) || isBlank(to)) {
    return null;
  }
  return from > to
    ? 'The start date is after the end date, which describes no period. Swap them, or clear one.'
    : null;
}

/** A numeric range that runs backwards — a min above its max. */
export function numberRangeError(
  lowLabel: string,
  low: number | null,
  highLabel: string,
  high: number | null,
): string | null {
  if (low === null || high === null) {
    return null;
  }
  return low > high ? `${lowLabel} cannot be more than ${highLabel}.` : null;
}

/** The first message among several checks, or null when they all pass. */
export function firstError(...errors: readonly (string | null)[]): string | null {
  return errors.find((error) => error !== null) ?? null;
}
