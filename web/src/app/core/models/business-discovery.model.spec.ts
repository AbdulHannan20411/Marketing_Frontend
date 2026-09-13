import {
  BUSINESS_CSV_HEADERS,
  type BusinessResult,
  buildBusinessCsv,
  exportablePhone,
} from './business-discovery.model';

function business(overrides: Partial<BusinessResult> = {}): BusinessResult {
  return {
    id: 'b1',
    name: 'Gulberg Barbers',
    phone: '+92 300 1234567',
    address: null,
    latitude: 31.5,
    longitude: 74.3,
    category: 'Barber',
    website: null,
    rating: null,
    openingHours: null,
    existsInContacts: false,
    ...overrides,
  };
}

/** Splits the file into rows, dropping the BOM and the trailing line break. */
function rowsOf(csv: string): string[] {
  return csv.replace(/^﻿/, '').replace(/\r\n$/, '').split('\r\n');
}

describe('business discovery export', () => {
  describe('exportablePhone', () => {
    it('keeps an international number', () => {
      expect(exportablePhone('+92 300 1234567', 'Pakistan')).toBe('+923001234567');
    });

    it('expands a national number using the search location country', () => {
      // Search returns the raw provider number whenever it cannot normalise
      // one, and file import does not convert — so this must happen here.
      expect(exportablePhone('0300 1234567', 'Pakistan')).toBe('+923001234567');
      expect(exportablePhone('0300 1234567', 'PK')).toBe('+923001234567');
    });

    it('refuses a national number it cannot expand', () => {
      // The direct import rejects this business; the file must not smuggle it in.
      expect(exportablePhone('0300 1234567', null)).toBeNull();
      expect(exportablePhone('0300 1234567', 'Atlantis')).toBeNull();
    });

    it('refuses missing or implausibly short numbers', () => {
      expect(exportablePhone(null, 'PK')).toBeNull();
      expect(exportablePhone('   ', 'PK')).toBeNull();
      expect(exportablePhone('12345', 'PK')).toBeNull();
    });
  });

  describe('buildBusinessCsv', () => {
    it('uses exactly the headers the importer auto-maps', () => {
      const { csv } = buildBusinessCsv([business()], { groupName: null, country: 'Pakistan' });
      expect(rowsOf(csv)[0]).toBe(BUSINESS_CSV_HEADERS.join(','));
      expect(BUSINESS_CSV_HEADERS).toEqual([
        'Phone number',
        'Full name',
        'Email',
        'Country',
        'Status',
        'Tags',
        'Groups',
      ]);
    });

    it('writes the country as an ISO code, never the display name', () => {
      const { csv } = buildBusinessCsv([business()], { groupName: null, country: 'Pakistan' });
      const cells = rowsOf(csv)[1].split(',');

      // A display name only resolves on import if it matches the runtime's
      // English country list exactly. A code always round-trips.
      expect(cells[3]).toBe('PK');
    });

    it('leaves country blank when the location country is unknown', () => {
      const { csv } = buildBusinessCsv([business()], { groupName: null, country: null });
      expect(rowsOf(csv)[1].split(',')[3]).toBe('');
    });

    it('omits businesses with no dialable number and counts them', () => {
      const result = buildBusinessCsv(
        [
          business({ id: 'ok' }),
          business({ id: 'none', phone: null }),
          business({ id: 'national-no-country', phone: '0300 7654321' }),
        ],
        { groupName: null, country: null },
      );

      expect(result.exported).toBe(1);
      expect(result.omitted).toBe(2);
      expect(rowsOf(result.csv).length).toBe(2); // header + one row
    });

    it('survives commas, quotes and bare carriage returns in names', () => {
      const { csv } = buildBusinessCsv(
        [business({ name: 'Cuts, "Fades"\rand More' })],
        { groupName: 'Barber · Gulberg, Lahore', country: 'PK' },
      );

      expect(csv).toContain('"Cuts, ""Fades""\rand More"');
      expect(csv).toContain('"Barber · Gulberg, Lahore"');
    });

    it('starts with a BOM and uses CRLF line endings', () => {
      const { csv } = buildBusinessCsv([business()], { groupName: null, country: 'PK' });
      expect(csv.startsWith('﻿')).toBeTrue();
      expect(csv.endsWith('\r\n')).toBeTrue();
      expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
    });
  });
});
