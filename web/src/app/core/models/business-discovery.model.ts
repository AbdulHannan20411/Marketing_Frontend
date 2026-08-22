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
 * Radii offered in the UI, in kilometres.
 *
 * Capped at 50: provider cost scales with area, and a 50 km circle over a city
 * already returns more businesses than anyone will review. The backend enforces
 * its own ceiling — this list is convenience, not security.
 */
export const RADIUS_OPTIONS_KM: readonly number[] = [1, 2, 5, 10, 20, 50];

export const DEFAULT_RADIUS_KM = 5;

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
  /** Written to Country when the search location implies one. */
  readonly country: string | null;
}

/**
 * Builds a CSV the existing Upload File tab accepts as-is.
 *
 * Businesses with no phone number are **omitted**: the importer requires one,
 * so including them would produce guaranteed row failures and an import summary
 * full of noise the user cannot act on.
 */
export function buildBusinessCsv(
  businesses: readonly BusinessResult[],
  options: BusinessCsvOptions,
): string {
  const rows = businesses.filter(isContactable).map((business) =>
    [
      csvCell(business.phone),
      csvCell(business.name),
      csvCell(null), // Providers do not return email; the column stays for shape.
      csvCell(options.country),
      'Subscribed',
      csvCell(business.category),
      csvCell(options.groupName),
    ].join(','),
  );

  // A BOM so Excel opens UTF-8 correctly — without it, accented business names
  // arrive mangled, which is exactly the sort of thing nobody notices until a
  // campaign goes out addressed to "Café" as "CafÃ©".
  return `﻿${[BUSINESS_CSV_HEADERS.join(','), ...rows].join('\r\n')}\r\n`;
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
