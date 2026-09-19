import { findCountry, hasEnoughDigits, toInternational } from '@core/models/phone.model';

/**
 * Business discovery: finding real businesses near a point and turning them
 * into contacts.
 *
 * The provider — Google Places, Overpass, whatever the backend settles on —
 * is deliberately invisible here. The client asks our own API for businesses
 * near a point and gets back this shape; swapping provider is a backend change
 * that this file never learns about. That is also why no provider key exists in
 * the browser.
 */

/* ------------------------------------------------------------------ *
 * Search inputs
 * ------------------------------------------------------------------ */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Radii offered before the plan's limit is known, in kilometres.
 *
 * The platform caps every search at 10 km: provider cost scales with area, and
 * a 10 km circle over a city already returns more businesses than anyone will
 * review. The backend enforces the ceiling — this list is convenience.
 */
export const RADIUS_OPTIONS_KM: readonly number[] = [1, 2, 5, 10];

export const DEFAULT_RADIUS_KM = 5;

/** The platform's own ceiling, whatever the plan says. */
export const MAX_RADIUS_KM = 10;

/**
 * The radii a plan allows: every whole kilometre from 1 to its limit, so a
 * 5 km plan offers 1–5 and a 10 km plan 1–10.
 *
 * - `null` (no plan ceiling) offers 1 to the platform's 10.
 * - `0` offers nothing: the plan has no nearby search.
 * - `undefined` — limits not loaded yet, or an API that does not send the
 *   field — keeps the old fixed list rather than offering nothing.
 */
export function radiusOptionsFor(limit: number | null | undefined): readonly number[] {
  if (limit === undefined) {
    return RADIUS_OPTIONS_KM;
  }
  const ceiling = limit === null ? MAX_RADIUS_KM : Math.min(Math.floor(limit), MAX_RADIUS_KM);
  return Array.from({ length: Math.max(0, ceiling) }, (_, index) => index + 1);
}

/**
 * The radius actually used: the choice if the plan allows it, otherwise the
 * widest allowed radius below it — so a 5 km default on a 3 km plan becomes 3.
 * `0` when nothing is allowed.
 */
export function effectiveRadius(chosen: number, options: readonly number[]): number {
  if (options.includes(chosen)) {
    return chosen;
  }
  const below = options.filter((option) => option <= chosen);
  return below.length > 0 ? below[below.length - 1] : (options[0] ?? 0);
}

export interface BusinessCategory {
  /** Sent to the API. Provider-neutral slug, e.g. `barber`. */
  readonly id: string;
  readonly label: string;
  /** Optional grouping for the picker, e.g. `Food & drink`. */
  readonly group?: string;
}

export interface BusinessSearchQuery {
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusKm: number;
  readonly category: string;
  readonly page: number;
  readonly pageSize: number;
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/**
 * One discovered business.
 *
 * Everything except `id` and `name` is optional and **genuinely absent** when
 * the provider did not return it. Nothing here is invented or defaulted: a
 * business with no phone shows no phone, because a fabricated number would be
 * dialled by a campaign.
 */
export interface BusinessResult {
  /** Provider id, stable enough to deduplicate a paged result set. */
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly address: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly category: string | null;
  readonly website: string | null;
  readonly rating: number | null;
  readonly openingHours: string | null;
  /**
   * Whether this business already exists in Contacts.
   *
   * Decided by the **backend**, which owns the canonical contact lookup and can
   * normalise phone numbers to E.164 before comparing. The client does not
   * attempt its own matching: guessing wrong in either direction is worse than
   * not showing the badge — a false "already imported" silently drops a real
   * prospect. `null` means the backend did not say.
   */
  readonly existsInContacts: boolean | null;
}

export interface BusinessSearchPage {
  readonly items: readonly BusinessResult[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly hasNextPage: boolean;
}

/** A business with no phone number cannot become a WhatsApp contact. */
export function isContactable(business: BusinessResult): boolean {
  return business.phone !== null && business.phone.trim() !== '';
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

export interface ImportBusinessesRequest {
  /** Provider ids of the chosen businesses. */
  readonly businessIds: readonly string[];
  /** Echoed so the backend can attribute and rate-limit the search. */
  readonly searchId: string | null;
  /** Group every imported contact into this, created if missing. */
  readonly groupName: string | null;
}

export interface ImportBusinessesResult {
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
  /** Per-business reasons for anything not imported. May be empty. */
  readonly failures: readonly ImportBusinessFailure[];
}

export interface ImportBusinessFailure {
  readonly businessId: string;
  readonly name: string;
  readonly reason: string;
}

/* ------------------------------------------------------------------ *
 * CSV export
 * ------------------------------------------------------------------ */

/**
 * Headers matching `IMPORT_TARGET_FIELDS` exactly, so the existing importer's
 * server-side `suggestedMapping` recognises every column without the user
 * touching the mapping step.
 *
 * **Deliberately only these seven.** The contact import format has no field for
 * address, website, rating or opening hours, and inventing columns for them
 * would either be ignored or trip the importer's `UnsupportedColumn` row error.
 * Business metadata survives the **direct import** path instead, where the
 * backend receives the full record — see the backend requirements document.
 */
export const BUSINESS_CSV_HEADERS: readonly string[] = [
  'Phone number',
  'Full name',
  'Email',
  'Country',
  'Status',
  'Tags',
  'Groups',
];

/** Escapes one CSV cell: quotes wrap anything containing a delimiter or quote. */
function csvCell(value: string | null): string {
  const text = (value ?? '').trim();
  if (text === '') {
    return '';
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface BusinessCsvOptions {
  /** Written to the Groups column so a discovered batch lands together. */
  readonly groupName: string | null;
  /**
   * The search location's country, as a display name or an ISO code.
   *
   * Used twice: to expand a national-format number, and to fill the Country
   * column. It is written out as an ISO code either way — see `buildBusinessCsv`.
   */
  readonly country: string | null;
}

export interface BusinessCsvResult {
  readonly csv: string;
  /** Rows actually written. */
  readonly exported: number;
  /** Selected businesses left out because no dialable number could be produced. */
  readonly omitted: number;
}

/**
 * The number as the direct import would store it, or `null`.
 *
 * **The file path and the direct path must agree.** Search returns the
 * provider's raw number whenever it cannot normalise one, and the file importer
 * does not convert national-format numbers. Written verbatim, such a number
 * imports cleanly and then fails at send time — while the direct import rejects
 * the very same business. Applying the same rule here means the spreadsheet and
 * the button produce the same contacts.
 */
export function exportablePhone(phone: string | null, country: string | null): string | null {
  if (phone === null || phone.trim() === '' || !hasEnoughDigits(phone)) {
    return null;
  }
  const international = toInternational(phone, country ?? '');
  return international === null ? null : `+${international}`;
}

/**
 * Builds a CSV the existing Upload File tab accepts as-is.
 *
 * Headers are the importer's own field labels, so its suggested mapping picks
 * up every column without the user touching the mapping step.
 *
 * Country is written as an **ISO code**, not the display name the location
 * search returns. The importer accepts both today, but a name only resolves if
 * it matches the runtime's English country list exactly — `Türkiye`, `Czechia`
 * or a localised spelling would silently fall back to guessing from the phone
 * number. A code always round-trips. Unknown stays blank, which is what the
 * importer already handles by deriving the country from the number.
 */
export function buildBusinessCsv(
  businesses: readonly BusinessResult[],
  options: BusinessCsvOptions,
): BusinessCsvResult {
  const countryCode = findCountry(options.country ?? '')?.iso ?? null;
  const rows: string[] = [];
  let omitted = 0;

  for (const business of businesses) {
    const phone = exportablePhone(business.phone, options.country);
    if (phone === null) {
      omitted++;
      continue;
    }
    rows.push(
      [
        csvCell(phone),
        csvCell(business.name),
        csvCell(null), // Providers do not return email; the column stays for shape.
        csvCell(countryCode),
        'Subscribed',
        csvCell(business.category),
        csvCell(options.groupName),
      ].join(','),
    );
  }

  // A BOM so Excel opens UTF-8 correctly — without it, accented business names
  // arrive mangled, which is exactly the sort of thing nobody notices until a
  // campaign goes out addressed to "Cafe" as "CafÃ©".
  const csv = `\uFEFF${[BUSINESS_CSV_HEADERS.join(','), ...rows].join('\r\n')}\r\n`;
  return { csv, exported: rows.length, omitted };
}

/** `barber-gulberg-lahore-2026-08-21.csv` */
export function businessCsvFileName(category: string, place: string | null): string {
  const slug = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const parts = [slug(category), place === null ? '' : slug(place)].filter((part) => part !== '');
  const stamp = new Date().toISOString().slice(0, 10);
  return `${[...parts, stamp].join('-')}.csv`;
}
