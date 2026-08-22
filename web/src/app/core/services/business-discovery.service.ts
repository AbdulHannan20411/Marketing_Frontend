import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type {
  BusinessCategory,
  BusinessSearchPage,
  BusinessSearchQuery,
  ImportBusinessesRequest,
  ImportBusinessesResult,
  LatLng,
} from '@core/models/business-discovery.model';
import { ApiService } from './api.service';

const BASE = '/business-discovery';

/** One place-search suggestion, for turning typed text into a point. */
export interface PlaceSuggestion {
  readonly id: string;
  /** What the user sees, e.g. `Gulberg, Lahore, Pakistan`. */
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  /** ISO country name or code, used to fill the CSV's Country column. */
  readonly country: string | null;
}

/** Wire shapes. Kept separate so a rename on either side is a mapper change. */
interface SearchResponseDto extends BusinessSearchPage {
  /** Correlates the import back to the search that produced it. */
  readonly searchId?: string;
}

/**
 * Business discovery.
 *
 * **Every call goes to our own API, never to a provider.** The provider key
 * lives on the server, the provider's quota is the server's to manage, and the
 * server is where tenant scoping and duplicate detection happen. A browser that
 * could call the provider directly would leak the key to every customer.
 *
 * None of these endpoints exist yet — see
 * `docs/BUSINESS_CONTACT_DISCOVERY_BACKEND_REQUIREMENTS.md`. Callers surface
 * the failure rather than faking results: a fabricated business list would be
 * exported to a spreadsheet and messaged.
 */
@Injectable({ providedIn: 'root' })
export class BusinessDiscoveryService {
  private readonly api = inject(ApiService);

  /**
   * Categories the provider supports.
   *
   * Served by the API rather than hard-coded so the list can track whatever
   * provider is in use. The caller keeps a small built-in list to fall back on,
   * so the picker is never empty.
   */
  listCategories(): Observable<readonly BusinessCategory[]> {
    return this.api.get<readonly BusinessCategory[]>(`${BASE}/categories`);
  }

  /**
   * Turns typed text into candidate points.
   *
   * Geocoding is a provider call too, so it goes through our API for the same
   * reasons as the search itself.
   */
  searchPlaces(query: string): Observable<readonly PlaceSuggestion[]> {
    return this.api.get<readonly PlaceSuggestion[]>(`${BASE}/places`, { query });
  }

  /** Reverse geocode, for naming a pin the user dropped or their GPS fix. */
  describePoint(point: LatLng): Observable<PlaceSuggestion | null> {
    return this.api.get<PlaceSuggestion | null>(`${BASE}/places/reverse`, {
      latitude: point.lat,
      longitude: point.lng,
    });
  }

  /**
   * One page of businesses near a point.
   *
   * `POST` rather than `GET` because the query is a structured object and
   * because provider searches are billable — a POST is not replayed by a
   * prefetching browser or cached by an intermediary.
   */
  search(query: BusinessSearchQuery): Observable<BusinessSearchPage & { searchId: string | null }> {
    return this.api
      .post<SearchResponseDto, BusinessSearchQuery>(`${BASE}/search`, query)
      .pipe(map((response) => ({ ...response, searchId: response.searchId ?? null })));
  }

  /**
   * Imports the chosen businesses as contacts.
   *
   * The client sends **ids, not records**: the backend already holds the search
   * result and can be trusted about what it found. Accepting client-supplied
   * business details would let anyone post arbitrary contacts through an
   * endpoint that skips the import pipeline's validation.
   */
  importBusinesses(request: ImportBusinessesRequest): Observable<ImportBusinessesResult> {
    return this.api.post<ImportBusinessesResult, ImportBusinessesRequest>(
      `${BASE}/import`,
      request,
    );
  }
}
