import type {
  BusinessCategory,
  BusinessResult,
} from '@core/models/business-discovery.model';
import { CONTACTS } from './mock-data';

/**
 * Mock business discovery.
 *
 * **Development only.** The real endpoints call a provider; nothing here ever
 * reaches production, and `useMockApi` gates the whole interceptor. Names are
 * obviously synthetic so a mock result can never be mistaken for a real lead
 * that someone then messages.
 */

export const MOCK_CATEGORIES: readonly BusinessCategory[] = [
  { id: 'barber', label: 'Barber', group: 'Personal care' },
  { id: 'beauty_salon', label: 'Beauty salon', group: 'Personal care' },
  { id: 'spa', label: 'Spa', group: 'Personal care' },
  { id: 'restaurant', label: 'Restaurant', group: 'Food & drink' },
  { id: 'cafe', label: 'Coffee shop', group: 'Food & drink' },
  { id: 'bakery', label: 'Bakery', group: 'Food & drink' },
  { id: 'gym', label: 'Gym', group: 'Health & fitness' },
  { id: 'dentist', label: 'Dentist', group: 'Health & fitness' },
  { id: 'pharmacy', label: 'Pharmacy', group: 'Health & fitness' },
  { id: 'clothing_store', label: 'Clothing store', group: 'Retail' },
  { id: 'electronics_store', label: 'Electronics store', group: 'Retail' },
  { id: 'hotel', label: 'Hotel', group: 'Hospitality' },
  { id: 'car_wash', label: 'Car wash', group: 'Automotive' },
  { id: 'car_repair', label: 'Car repair', group: 'Automotive' },
  { id: 'real_estate_agency', label: 'Real estate agency', group: 'Services' },
  { id: 'electrician', label: 'Electrician', group: 'Services' },
];

const PLACE_SEED: readonly { label: string; lat: number; lng: number; country: string }[] = [
  { label: 'Gulberg, Lahore, Pakistan', lat: 31.5204, lng: 74.3587, country: 'Pakistan' },
  { label: 'DHA Phase 5, Lahore, Pakistan', lat: 31.4704, lng: 74.4092, country: 'Pakistan' },
  { label: 'Blue Area, Islamabad, Pakistan', lat: 33.7094, lng: 73.0551, country: 'Pakistan' },
  { label: 'Clifton, Karachi, Pakistan', lat: 24.8138, lng: 67.0299, country: 'Pakistan' },
  { label: 'Manchester, United Kingdom', lat: 53.4808, lng: -2.2426, country: 'United Kingdom' },
  { label: 'Shoreditch, London, United Kingdom', lat: 51.5262, lng: -0.0777, country: 'United Kingdom' },
];

export function mockPlaces(query: string): readonly {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  country: string;
}[] {
  const term = query.trim().toLowerCase();
  return PLACE_SEED.filter((place) => place.label.toLowerCase().includes(term)).map(
    (place, index) => ({
      id: `place_${index}`,
      label: place.label,
      latitude: place.lat,
      longitude: place.lng,
      country: place.country,
    }),
  );
}

export function mockReversePlace(lat: number, lng: number) {
  // Nearest seeded place, so a dropped pin gets a plausible name.
  const nearest = [...PLACE_SEED].sort(
    (a, b) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng),
  )[0];

  return {
    id: 'place_reverse',
    label: `Near ${nearest.label}`,
    latitude: lat,
    longitude: lng,
    country: nearest.country,
  };
}

const STREETS = [
  'Main Boulevard',
  'Ferozepur Road',
  'MM Alam Road',
  'Canal Bank Road',
  'Jail Road',
  'Liberty Market',
];

const PREFIXES = ['Elite', 'Classic', 'Royal', 'Prime', 'Urban', 'The Corner', 'Downtown', 'Star'];

/**
 * A stable pseudo-random generator.
 *
 * Seeded from the query so the same search returns the same businesses — a
 * result set that reshuffled on every "Load more" would duplicate and drop rows
 * across pages, which is exactly the bug paging is meant to avoid.
 */
function seeded(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function hash(text: string): number {
  let total = 0;
  for (let index = 0; index < text.length; index++) {
    total = (total * 31 + text.charCodeAt(index)) % 2147483647;
  }
  return total;
}

/** Phone numbers already in Contacts, so `existsInContacts` means something. */
const EXISTING_PHONES = new Set(
  CONTACTS.slice(0, 40).map((contact) => contact.phoneNumber.replace(/[^\d+]/g, '')),
);

export function mockBusinessSearch(
  latitude: number,
  longitude: number,
  radiusKm: number,
  category: string,
  page: number,
  pageSize: number,
): { items: readonly BusinessResult[]; total: number } {
  const label = MOCK_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
  const random = seeded(hash(`${category}:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${radiusKm}`));

  // More area, more businesses — but sub-linear, because density falls off.
  const total = Math.min(120, Math.max(4, Math.round(radiusKm * 6 + random() * 12)));

  const all: BusinessResult[] = Array.from({ length: total }, (_, index) => {
    const spread = radiusKm / 111; // ~degrees per km
    const lat = latitude + (random() - 0.5) * spread * 1.6;
    const lng = longitude + (random() - 0.5) * spread * 1.6;

    // A realistic slice have no phone at all — the UI has to cope with that,
    // and a mock where everything is perfect hides the case that matters.
    const hasPhone = random() > 0.12;
    const digits = Math.floor(random() * 9_000_000) + 1_000_000;
    const phone = hasPhone ? `+92 300 ${String(digits).slice(0, 7)}` : null;

    const existing = phone !== null && EXISTING_PHONES.has(phone.replace(/[^\d+]/g, ''));

    return {
      id: `biz_${category}_${index}`,
      name: `${PREFIXES[index % PREFIXES.length]} ${label}${index % 3 === 0 ? ' & Co' : ''}`,
      phone,
      address: `${10 + index} ${STREETS[index % STREETS.length]}`,
      latitude: lat,
      longitude: lng,
      category: label,
      website: random() > 0.6 ? `https://example.com/${category}-${index}` : null,
      rating: random() > 0.3 ? Math.round((3 + random() * 2) * 10) / 10 : null,
      openingHours: random() > 0.5 ? 'Mon–Sat, 10:00–20:00' : null,
      // Roughly one in six is already a contact, so the badge and the New /
      // Already imported filters have something to show.
      existsInContacts: existing || index % 6 === 0,
    };
  });

  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total };
}
