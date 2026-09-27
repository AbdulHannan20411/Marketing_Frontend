/**
 * Phone numbers, and the one mistake that silently breaks a campaign.
 *
 * A leading zero is a **national trunk prefix** — it exists to dial inside a
 * country and never appears in an international number. `0336 7890092` stored
 * as-is looks right on every screen, passes every check, and is rejected by
 * Meta at send time with an opaque provider code. Nobody finds out until the
 * campaign has already failed.
 *
 * The API converts these on contact create and update. This module exists so
 * the conversion is **visible before saving**, and so the file-import path —
 * which the API does not yet convert — can at least warn.
 */

export interface DiallingCountry {
  /** ISO 3166-1 alpha-2. */
  readonly iso: string;
  readonly name: string;
  /** International dialling code, no plus. */
  readonly dial: string;
}

/**
 * Dialling codes for the markets this product actually sells into, plus the
 * large ones people paste numbers from.
 *
 * Deliberately not the full ISO list. An unrecognised country is handled
 * gracefully — the preview simply does not appear and the API is left to do the
 * conversion — so a missing entry costs a hint, not a failed save. Add to it
 * freely; nothing else needs to change.
 */
export const DIALLING_COUNTRIES: readonly DiallingCountry[] = [
  { iso: 'PK', name: 'Pakistan', dial: '92' },
  { iso: 'GB', name: 'United Kingdom', dial: '44' },
  { iso: 'US', name: 'United States', dial: '1' },
  { iso: 'CA', name: 'Canada', dial: '1' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966' },
  { iso: 'IN', name: 'India', dial: '91' },
  { iso: 'BD', name: 'Bangladesh', dial: '880' },
  { iso: 'ID', name: 'Indonesia', dial: '62' },
  { iso: 'MY', name: 'Malaysia', dial: '60' },
  { iso: 'SG', name: 'Singapore', dial: '65' },
  { iso: 'PH', name: 'Philippines', dial: '63' },
  { iso: 'TR', name: 'Türkiye', dial: '90' },
  { iso: 'EG', name: 'Egypt', dial: '20' },
  { iso: 'NG', name: 'Nigeria', dial: '234' },
  { iso: 'KE', name: 'Kenya', dial: '254' },
  { iso: 'ZA', name: 'South Africa', dial: '27' },
  { iso: 'DE', name: 'Germany', dial: '49' },
  { iso: 'FR', name: 'France', dial: '33' },
  { iso: 'ES', name: 'Spain', dial: '34' },
  { iso: 'IT', name: 'Italy', dial: '39' },
  { iso: 'NL', name: 'Netherlands', dial: '31' },
  { iso: 'BE', name: 'Belgium', dial: '32' },
  { iso: 'PT', name: 'Portugal', dial: '351' },
  { iso: 'IE', name: 'Ireland', dial: '353' },
  { iso: 'PL', name: 'Poland', dial: '48' },
  { iso: 'SE', name: 'Sweden', dial: '46' },
  { iso: 'NO', name: 'Norway', dial: '47' },
  { iso: 'DK', name: 'Denmark', dial: '45' },
  { iso: 'AU', name: 'Australia', dial: '61' },
  { iso: 'NZ', name: 'New Zealand', dial: '64' },
  { iso: 'BR', name: 'Brazil', dial: '55' },
  { iso: 'MX', name: 'Mexico', dial: '52' },
  { iso: 'AR', name: 'Argentina', dial: '54' },
  { iso: 'QA', name: 'Qatar', dial: '974' },
  { iso: 'KW', name: 'Kuwait', dial: '965' },
  { iso: 'OM', name: 'Oman', dial: '968' },
  { iso: 'BH', name: 'Bahrain', dial: '973' },
  { iso: 'LK', name: 'Sri Lanka', dial: '94' },
  { iso: 'NP', name: 'Nepal', dial: '977' },
];

/** The API's plausibility floor; fewer digits is refused whatever the country. */
export const MIN_PHONE_DIGITS = 7;

/** Digits only, with any leading `+` remembered separately. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Whether a number was typed the local way.
 *
 * True for `0336…` and also for `+0336…`, which is how the already-broken
 * records in the database look: a plus does not make a trunk prefix
 * international, it just hides it.
 *
 * Also true for `00923…`. That one *can* be expanded without a country — see
 * {@link hasExitPrefix} — but as written it is still not storable E.164, so it
 * belongs in the import warning and the stored-contact badge alongside the rest.
 */
export function looksNational(value: string): boolean {
  const digits = digitsOf(value);
  return digits.length > 0 && digits.startsWith('0');
}

/** Enough digits to be a real number. */
export function hasEnoughDigits(value: string): boolean {
  return digitsOf(value).length >= MIN_PHONE_DIGITS;
}

/**
 * Resolves a country written as an ISO code or a name.
 *
 * The country field is free text, so `PK`, `pk` and `Pakistan` all have to
 * work — a user who types their country in full should not silently lose the
 * preview.
 */
export function findCountry(value: string): DiallingCountry | null {
  const term = value.trim().toLowerCase();
  if (term === '') {
    return null;
  }
  return (
    DIALLING_COUNTRIES.find(
      (entry) => entry.iso.toLowerCase() === term || entry.name.toLowerCase() === term,
    ) ?? null
  );
}

/**
 * Whether the number opens with the international *exit* prefix.
 *
 * `00` and `+` mean the same thing: what follows is already a full
 * international number, country code and all. `00923367890092` is `+92 336
 * 7890092` dialled from a landline, so the zeros come off and **nothing** is
 * added — treating that first zero as a trunk prefix doubles the country code.
 */
export function hasExitPrefix(value: string): boolean {
  return digitsOf(value).startsWith('00');
}

/**
 * The number as it will actually be stored, or `null` when it cannot be worked
 * out here.
 *
 * Three cases, in this order — the order is the whole rule:
 *
 * 1. `00…` — an exit prefix. Strip the two zeros, add nothing, and ignore the
 *    country: the code is already in the number.
 * 2. `0…` — a national trunk prefix. Strip **exactly one** zero and prefix the
 *    country's code. Stripping every leading zero eats a digit from any
 *    subscriber number that legitimately starts with one.
 * 3. Anything else is already international and is returned untouched.
 */
export function toInternational(value: string, country: string): string | null {
  const digits = digitsOf(value);
  if (digits === '') {
    return null;
  }

  // 1. Already international, written the long way.
  if (digits.startsWith('00')) {
    const dialled = digits.slice(2);
    return dialled === '' ? null : dialled;
  }

  // 3. Already international.
  if (!digits.startsWith('0')) {
    return digits;
  }

  // 2. National. The country is the only thing that can supply the code.
  const resolved = findCountry(country);
  if (resolved === null) {
    return null;
  }

  return `${resolved.dial}${digits.slice(1)}`;
}

/** `+92 336 7890092` — grouped for reading, not for storage. */
export function formatInternational(digits: string): string {
  const country = DIALLING_COUNTRIES.filter((entry) => digits.startsWith(entry.dial)).sort(
    (a, b) => b.dial.length - a.dial.length,
  )[0];

  if (country === undefined) {
    return `+${digits}`;
  }

  const rest = digits.slice(country.dial.length);
  const head = rest.slice(0, 3);
  const tail = rest.slice(3);
  return tail === '' ? `+${country.dial} ${head}` : `+${country.dial} ${head} ${tail}`;
}

/**
 * The country a written-out international number belongs to, by its code.
 *
 * Longest match wins, the same way {@link formatInternational} groups: `1`
 * would otherwise claim every `+1x…` number away from a longer code that
 * starts with the same digit.
 */
export function countryOfNumber(value: string): DiallingCountry | null {
  let digits = digitsOf(value);
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits === '' || digits.startsWith('0')) {
    // National, or nothing. The number carries no country of its own.
    return null;
  }

  return (
    DIALLING_COUNTRIES.filter((entry) => digits.startsWith(entry.dial)).sort(
      (a, b) => b.dial.length - a.dial.length,
    )[0] ?? null
  );
}

/** A number whose own country code contradicts the country that was chosen. */
export interface CountryConflict {
  /** The code the number opens with, no plus. */
  readonly dial: string;
  /** Every country that uses that code — `+1` is both the US and Canada. */
  readonly countries: readonly DiallingCountry[];
  readonly selected: DiallingCountry;
}

/**
 * Whether the number's own country code disagrees with the chosen country.
 *
 * The mistake this catches: picking **United States (+1)** and then pasting
 * `+923365471147`. Both fields are individually valid, the number saves
 * exactly as typed, and the contact ends up filed under a country it has
 * nothing to do with — so every audience built by country, and every report
 * broken down by it, is quietly wrong. Nothing downstream can detect it,
 * because there is no contradiction left in the stored row: the country says
 * one thing and the digits say another, and both are plausible.
 *
 * Compared by **dialling code, not by country**, which is what makes `+1`
 * work: the United States and Canada share it, so a Canadian number with the
 * United States selected is not a conflict this can see — and guessing between
 * them from the digits alone is not possible.
 *
 * Returns null for every case that is not a genuine contradiction: a national
 * number (the country supplies the code, which is the normal flow), a country
 * that is not in the list, and a code that is not in the list.
 */
export function countryConflict(value: string, country: string): CountryConflict | null {
  const selected = findCountry(country);
  if (selected === null) {
    return null;
  }

  const detected = countryOfNumber(value);
  if (detected === null || detected.dial === selected.dial) {
    return null;
  }

  return {
    dial: detected.dial,
    countries: DIALLING_COUNTRIES.filter((entry) => entry.dial === detected.dial),
    selected,
  };
}

/** "Pakistan", or "the United States or Canada" when a code is shared. */
export function describeCountries(countries: readonly DiallingCountry[]): string {
  const names = countries.map((entry) => entry.name);
  if (names.length <= 1) {
    return names[0] ?? 'another country';
  }
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * Whether a **stored** number is not in international form.
 *
 * Used to surface contacts saved before the API started converting. Anything
 * whose digits begin with a zero was stored wrong and will never deliver.
 */
export function isStoredNonInternational(phoneNumber: string): boolean {
  return looksNational(phoneNumber);
}

/** Shown wherever a national number needs explaining, so the wording matches. */
export const NATIONAL_FORMAT_WARNING =
  'This number is in national format and may not be deliverable. Use international format, for example 923367890092.';
