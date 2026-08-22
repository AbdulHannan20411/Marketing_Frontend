import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

import type { ApiError } from '@core/models/api.model';
import type {
  BusinessCategory,
  BusinessResult,
  ImportBusinessesResult,
  LatLng,
} from '@core/models/business-discovery.model';
import {
  DEFAULT_RADIUS_KM,
  RADIUS_OPTIONS_KM,
  buildBusinessCsv,
  businessCsvFileName,
  isContactable,
} from '@core/models/business-discovery.model';
import {
  BusinessDiscoveryService,
  type PlaceSuggestion,
} from '@core/services/business-discovery.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { MapPickerComponent, type MapMarker } from '@shared/ui/map-picker/map-picker.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';

/** Where the map starts before the user has chosen anywhere. */
const FALLBACK_CENTER: LatLng = { lat: 31.5204, lng: 74.3587 };

const PAGE_SIZE = 25;

/**
 * Offered until the API answers.
 *
 * Not the real list — the provider decides that — but a picker with nothing in
 * it looks broken, and these are common enough to be useful while the request
 * is in flight or if it fails.
 */
const FALLBACK_CATEGORIES: readonly BusinessCategory[] = [
  { id: 'barber', label: 'Barber' },
  { id: 'beauty_salon', label: 'Beauty salon' },
  { id: 'restaurant', label: 'Restaurant' },
  { id: 'cafe', label: 'Coffee shop' },
  { id: 'gym', label: 'Gym' },
  { id: 'dentist', label: 'Dentist' },
  { id: 'pharmacy', label: 'Pharmacy' },
  { id: 'clothing_store', label: 'Clothing store' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'car_wash', label: 'Car wash' },
  { id: 'real_estate_agency', label: 'Real estate agency' },
  { id: 'electrician', label: 'Electrician' },
];

type ResultFilter = 'all' | 'new' | 'existing';
type Stage = 'search' | 'results' | 'review';

/**
 * Find real businesses near a point and turn them into contacts.
 *
 * Three stages on one screen — choose where and what, review what came back,
 * then confirm — because a wizard would hide the map behind a Next button when
 * the map is the thing being reasoned about.
 *
 * Every provider call goes through our API. Nothing here knows which provider
 * is behind it, and no key is present in the browser.
 */
@Component({
  selector: 'app-business-discovery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    ButtonDirective,
    CardComponent,
    IconComponent,
    MapPickerComponent,
    ModalComponent,
    SkeletonComponent,
    EmptyStateComponent,
  ],
  templateUrl: './business-discovery.component.html',
})
export class BusinessDiscoveryComponent {
  private readonly discovery = inject(BusinessDiscoveryService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly radiusOptions = RADIUS_OPTIONS_KM;
  protected readonly stage = signal<Stage>('search');

  /* ------------------------------ location ------------------------------ */

  protected readonly center = signal<LatLng>(FALLBACK_CENTER);
  protected readonly placeLabel = signal<string | null>(null);
  protected readonly placeCountry = signal<string | null>(null);
  protected readonly placeQuery = signal('');
  protected readonly suggestions = signal<readonly PlaceSuggestion[]>([]);
  protected readonly searchingPlaces = signal(false);
  protected readonly locatingMe = signal(false);

  private readonly placeInput = new Subject<string>();

  /* ------------------------------- inputs ------------------------------- */

  protected readonly radiusKm = signal(DEFAULT_RADIUS_KM);
  protected readonly categories = signal<readonly BusinessCategory[]>(FALLBACK_CATEGORIES);
  protected readonly categoryQuery = signal('');
  protected readonly categoryId = signal<string | null>(null);
  protected readonly categoryOpen = signal(false);

  protected readonly visibleCategories = computed(() => {
    const term = this.categoryQuery().trim().toLowerCase();
    const all = this.categories();
    return term === '' ? all : all.filter((entry) => entry.label.toLowerCase().includes(term));
  });

  protected readonly selectedCategory = computed(
    () => this.categories().find((entry) => entry.id === this.categoryId()) ?? null,
  );

  /* ------------------------------- results ------------------------------- */

  protected readonly results = signal<readonly BusinessResult[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly hasNextPage = signal(false);
  protected readonly searchId = signal<string | null>(null);
  protected readonly searching = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly searchError = signal<string | null>(null);
  protected readonly hasSearched = signal(false);
  protected readonly filter = signal<ResultFilter>('all');

  /** Ids, so a selection survives paging and filtering. */
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  protected readonly importing = signal(false);
  protected readonly confirmingImport = signal(false);
  protected readonly importResult = signal<ImportBusinessesResult | null>(null);

  constructor() {
    this.placeInput
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((term) => {
          this.searchingPlaces.set(true);
          return this.discovery.searchPlaces(term);
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (found) => {
          this.suggestions.set(found);
          this.searchingPlaces.set(false);
        },
        // Geocoding is a convenience; the map and pin still work without it.
        error: () => {
          this.suggestions.set([]);
          this.searchingPlaces.set(false);
        },
      });

    this.discovery.listCategories().subscribe({
      next: (found) => {
        if (found.length > 0) {
          this.categories.set(found);
        }
      },
      error: () => {
        // Keep the fallback list. Saying "categories unavailable" would imply
        // the feature is broken when it is entirely usable.
      },
    });
  }

  /* ------------------------------ location ------------------------------ */

  protected onPlaceQuery(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.placeQuery.set(value);
    if (value.trim().length >= 3) {
      this.placeInput.next(value.trim());
    } else {
      this.suggestions.set([]);
    }
  }

  protected choosePlace(place: PlaceSuggestion): void {
    this.center.set({ lat: place.latitude, lng: place.longitude });
    this.placeLabel.set(place.label);
    this.placeCountry.set(place.country);
    this.placeQuery.set(place.label);
    this.suggestions.set([]);
  }

  /**
   * Moves the search centre to a dropped pin.
   *
   * The label is cleared immediately and re-derived asynchronously: showing the
   * previous place's name against a new pin would be actively misleading, and
   * the reverse geocode may not answer at all.
   */
  protected onCenterChanged(point: LatLng): void {
    this.center.set(point);
    this.placeLabel.set(null);
    this.placeQuery.set('');

    this.discovery.describePoint(point).subscribe({
      next: (place) => {
        if (place !== null) {
          this.placeLabel.set(place.label);
          this.placeCountry.set(place.country);
          this.placeQuery.set(place.label);
        }
      },
      error: () => {
        // A pin with no name is fine — the coordinates are what get searched.
      },
    });
  }

  /**
   * Browser geolocation, only ever on an explicit click.
   *
   * Never called on load: a permission prompt nobody asked for is the fastest
   * way to have it denied permanently.
   */
  protected useMyLocation(): void {
    if (!('geolocation' in navigator)) {
      this.toast.error('Location unavailable', 'This browser cannot share your location.');
      return;
    }

    this.locatingMe.set(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.locatingMe.set(false);
        this.onCenterChanged({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        this.locatingMe.set(false);
        this.toast.error(
          'Could not get your location',
          'Permission was denied or the request timed out. Drop a pin on the map instead.',
        );
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }

  protected setRadius(km: number): void {
    this.radiusKm.set(km);
  }

  /* ------------------------------ category ------------------------------ */

  protected toggleCategoryList(): void {
    this.categoryOpen.update((open) => !open);
  }

  protected onCategoryQuery(event: Event): void {
    this.categoryQuery.set((event.target as HTMLInputElement).value);
  }

  protected chooseCategory(category: BusinessCategory): void {
    this.categoryId.set(category.id);
    this.categoryQuery.set('');
    this.categoryOpen.set(false);
  }

  /* ------------------------------- search ------------------------------- */

  protected readonly canSearch = computed(
    () => this.categoryId() !== null && this.radiusKm() > 0 && !this.searching(),
  );

  protected search(): void {
    if (!this.canSearch()) {
      return;
    }

    this.searching.set(true);
    this.searchError.set(null);
    this.page.set(1);

    this.runSearch(1, (page) => {
      this.results.set(page.items);
      this.selectedIds.set(new Set());
      this.stage.set('results');
    });
  }

  protected loadMore(): void {
    if (this.loadingMore() || !this.hasNextPage()) {
      return;
    }
    this.loadingMore.set(true);
    const next = this.page() + 1;

    this.runSearch(next, (page) => {
      // Merged by id: a provider can repeat a business across page boundaries,
      // and a duplicated row would be exported and imported twice.
      const seen = new Set(this.results().map((entry) => entry.id));
      const fresh = page.items.filter((entry) => !seen.has(entry.id));
      this.results.update((current) => [...current, ...fresh]);
      this.page.set(next);
    });
  }

  private runSearch(page: number, onPage: (page: { items: readonly BusinessResult[] }) => void): void {
    const category = this.categoryId();
    if (category === null) {
      return;
    }
    const point = this.center();

    this.discovery
      .search({
        latitude: point.lat,
        longitude: point.lng,
        radiusKm: this.radiusKm(),
        category,
        page,
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (result) => {
          onPage(result);
          this.total.set(result.total);
          this.hasNextPage.set(result.hasNextPage);
          this.searchId.set(result.searchId);
          this.hasSearched.set(true);
          this.searching.set(false);
          this.loadingMore.set(false);
        },
        error: (error: ApiError) => {
          this.searching.set(false);
          this.loadingMore.set(false);
          this.hasSearched.set(true);
          this.searchError.set(this.describeSearchError(error));
        },
      });
  }

  /**
   * Turns an API failure into something a user can act on.
   *
   * Quota and rate-limit failures get their own wording because "something went
   * wrong" would have them retry immediately and burn more of the allowance.
   * Nothing here names the provider or leaks its response.
   */
  private describeSearchError(error: ApiError): string {
    if (error.status === 429 || error.errorCode === 'search_limit_reached') {
      return 'Business search limit reached. Please try again later.';
    }
    if (error.status === 402 || error.errorCode === 'provider_quota_exceeded') {
      return 'Business search is temporarily unavailable on this workspace. Please contact support.';
    }
    if (error.status === 404 || error.status === 405 || error.status === 501) {
      return 'Business search is not available yet on this deployment.';
    }
    return error.detail;
  }

  /* ------------------------------ selection ------------------------------ */

  protected readonly visibleResults = computed(() => {
    const mode = this.filter();
    const all = this.results();

    if (mode === 'new') {
      return all.filter((entry) => entry.existsInContacts !== true);
    }
    if (mode === 'existing') {
      return all.filter((entry) => entry.existsInContacts === true);
    }
    return all;
  });

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly selected = computed(() =>
    this.results().filter((entry) => this.selectedIds().has(entry.id)),
  );

  protected readonly selectedNew = computed(
    () => this.selected().filter((entry) => entry.existsInContacts !== true).length,
  );

  protected readonly selectedExisting = computed(
    () => this.selected().filter((entry) => entry.existsInContacts === true).length,
  );

  /** Selected businesses with no phone cannot be imported; surfaced, not hidden. */
  protected readonly selectedUncontactable = computed(
    () => this.selected().filter((entry) => !isContactable(entry)).length,
  );

  protected readonly allVisibleSelected = computed(() => {
    const visible = this.visibleResults().filter(isContactable);
    return visible.length > 0 && visible.every((entry) => this.selectedIds().has(entry.id));
  });

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected toggle(business: BusinessResult): void {
    if (!isContactable(business)) {
      return;
    }
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (!next.delete(business.id)) {
        next.add(business.id);
      }
      return next;
    });
  }

  /** Applies to what is on screen, so a filter narrows what "all" means. */
  protected toggleAllVisible(): void {
    const visible = this.visibleResults().filter(isContactable);
    const selectAll = !this.allVisibleSelected();

    this.selectedIds.update((current) => {
      const next = new Set(current);
      for (const entry of visible) {
        if (selectAll) {
          next.add(entry.id);
        } else {
          next.delete(entry.id);
        }
      }
      return next;
    });
  }

  protected setFilter(mode: ResultFilter): void {
    this.filter.set(mode);
  }

  /* ------------------------------- review ------------------------------- */

  protected review(): void {
    if (this.selectedCount() === 0) {
      return;
    }
    this.stage.set('review');
  }

  protected backToResults(): void {
    this.stage.set('results');
  }

  /** `Barber · Gulberg, Lahore` — the group discovered contacts land in. */
  protected readonly groupName = computed(() => {
    const category = this.selectedCategory()?.label ?? null;
    const place = this.placeLabel();
    if (category === null) {
      return null;
    }
    return place === null ? category : `${category} · ${place}`;
  });

  /* ------------------------------- export ------------------------------- */

  /**
   * Builds the CSV in the browser and saves it.
   *
   * No round trip: the data is already here, and the existing importer accepts
   * CSV. Columns match the import format's own field labels so the mapping step
   * recognises them without the user touching it.
   */
  protected downloadCsv(): void {
    const chosen = this.selected();
    const contactable = chosen.filter(isContactable);

    if (contactable.length === 0) {
      this.toast.error(
        'Nothing to download',
        'None of the selected businesses has a phone number, so none can be imported.',
      );
      return;
    }

    const csv = buildBusinessCsv(chosen, {
      groupName: this.groupName(),
      country: this.placeCountry(),
    });

    const category = this.selectedCategory()?.label ?? 'businesses';
    const name = businessCsvFileName(category, this.placeLabel());

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);

    this.toast.success(
      'Spreadsheet downloaded',
      `${contactable.length} ${contactable.length === 1 ? 'business' : 'businesses'} ready for the Upload file tab.`,
    );
  }

  /* ------------------------------- import ------------------------------- */

  protected askToImport(): void {
    if (this.selectedCount() === 0) {
      return;
    }
    this.confirmingImport.set(true);
  }

  protected cancelImport(): void {
    this.confirmingImport.set(false);
  }

  protected confirmImport(): void {
    this.confirmingImport.set(false);
    this.importing.set(true);

    this.discovery
      .importBusinesses({
        businessIds: this.selected().map((entry) => entry.id),
        searchId: this.searchId(),
        groupName: this.groupName(),
      })
      .subscribe({
        next: (result) => {
          this.importing.set(false);
          this.importResult.set(result);
        },
        error: (error: ApiError) => {
          this.importing.set(false);
          this.toast.error('Import failed', this.describeSearchError(error));
        },
      });
  }

  protected dismissResult(): void {
    this.importResult.set(null);
    // Imported businesses are now contacts, so their badges are stale. Clearing
    // the selection stops a second import of the same rows.
    this.selectedIds.set(new Set());
    this.stage.set('results');
  }

  protected viewContacts(): void {
    void this.router.navigate(['/contacts']);
  }

  /* -------------------------------- map -------------------------------- */

  protected readonly mapMarkers = computed<readonly MapMarker[]>(() =>
    this.visibleResults().map((entry) => ({
      id: entry.id,
      lat: entry.latitude,
      lng: entry.longitude,
      label: entry.name,
      selected: this.selectedIds().has(entry.id),
      muted: !isContactable(entry),
    })),
  );

  protected onMarkerClicked(id: string): void {
    const business = this.results().find((entry) => entry.id === id);
    if (business !== undefined) {
      this.toggle(business);
    }
  }

  protected trackById(_: number, business: BusinessResult): string {
    return business.id;
  }
}
