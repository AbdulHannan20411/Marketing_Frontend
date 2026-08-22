import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as L from 'leaflet';

/** Where the copied Leaflet stylesheet lands. See `angular.json` assets. */
const LEAFLET_CSS_HREF = 'vendor/leaflet/leaflet.css';

/** Default tile source. Overridable so production can point at a licensed one. */
const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION = '&copy; OpenStreetMap contributors';

/** One plottable point. Deliberately not a business — see the class comment. */
export interface MapMarker {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
  /** Drawn in the selected style and lifted above the others. */
  readonly selected: boolean;
  /** Dimmed and non-interactive — used for points that cannot be acted on. */
  readonly muted?: boolean;
}

/**
 * An interactive map: a draggable centre pin, a radius circle, and markers.
 *
 * **Knows nothing about businesses, contacts or any provider.** It takes points
 * and gives back interactions, which is what keeps it reusable and what stops a
 * provider's vocabulary leaking into a shared component. Anything business-
 * shaped belongs in the feature that hosts it.
 *
 * Leaflet is loaded with a dynamic `import()`, so neither the library nor its
 * stylesheet touches the initial bundle — they arrive with the first map the
 * user actually opens.
 */
@Component({
  selector: 'app-map-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="relative h-full w-full overflow-hidden rounded-xl ring-1 ring-line">
      <div #canvas class="h-full w-full" [class.opacity-0]="!ready()"></div>

      @if (!ready()) {
        <div class="absolute inset-0 grid place-items-center bg-surface-sunken">
          @if (failed()) {
            <div class="px-6 text-center">
              <p class="text-sm font-medium text-ink">The map could not be loaded</p>
              <p class="mt-1 text-xs text-ink-muted">
                You can still search and import without it.
              </p>
            </div>
          } @else {
            <p class="text-sm text-ink-muted">Loading map…</p>
          }
        </div>
      }
    </div>
  `,
})
export class MapPickerComponent {
  private readonly canvas = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

  readonly center = input.required<{ lat: number; lng: number }>();
  readonly radiusKm = input(0);
  readonly markers = input<readonly MapMarker[]>([]);
  readonly zoom = input(13);
  readonly tileUrl = input(DEFAULT_TILE_URL);
  readonly attribution = input(DEFAULT_ATTRIBUTION);
  /** Turns off click-to-move and pin dragging while a search is running. */
  readonly interactive = input(true);

  /** The user moved the centre, by dragging the pin or clicking the map. */
  readonly centerChanged = output<{ lat: number; lng: number }>();
  readonly markerClicked = output<string>();

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);

  private leaflet: typeof L | null = null;
  private map: L.Map | null = null;
  private pin: L.Marker | null = null;
  private circle: L.Circle | null = null;
  private layer: L.LayerGroup | null = null;
  /** Markers currently drawn, so a re-render can diff instead of rebuilding. */
  private drawn = new Map<string, L.Marker>();

  constructor() {
    void this.load();

    // Centre, radius and markers each redraw independently: rebuilding the map
    // for a radius change would flash the tiles and lose the user's pan.
    effect(() => {
      const point = this.center();
      untracked(() => this.applyCenter(point));
    });

    effect(() => {
      const km = this.radiusKm();
      untracked(() => this.applyRadius(km));
    });

    effect(() => {
      const points = this.markers();
      untracked(() => this.applyMarkers(points));
    });

    inject(DestroyRef).onDestroy(() => {
      this.map?.remove();
      this.map = null;
    });
  }

  /* ------------------------------- loading ------------------------------- */

  private async load(): Promise<void> {
    try {
      this.ensureStylesheet();
      this.leaflet = await import('leaflet');
      this.create();
      this.ready.set(true);
    } catch {
      // A failed map must not take the feature down with it: searching,
      // selecting and importing all work from the list alone.
      this.failed.set(true);
    }
  }

  /** Injects the stylesheet once per document, not once per map. */
  private ensureStylesheet(): void {
    if (document.querySelector(`link[href="${LEAFLET_CSS_HREF}"]`) !== null) {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LEAFLET_CSS_HREF;
    document.head.appendChild(link);
  }

  private create(): void {
    const leaflet = this.leaflet;
    if (leaflet === null) {
      return;
    }

    const point = this.center();
    this.map = leaflet.map(this.canvas().nativeElement, {
      center: [point.lat, point.lng],
      zoom: this.zoom(),
      // Scroll-wheel zoom hijacks page scrolling on a long form; Ctrl+wheel and
      // the +/- buttons still zoom, and pinch works on touch.
      scrollWheelZoom: false,
      attributionControl: true,
    });

    leaflet
      .tileLayer(this.tileUrl(), { attribution: this.attribution(), maxZoom: 19 })
      .addTo(this.map);

    this.layer = leaflet.layerGroup().addTo(this.map);

    this.pin = leaflet
      .marker([point.lat, point.lng], {
        draggable: this.interactive(),
        icon: this.pinIcon(),
        keyboard: true,
        title: 'Search centre — drag to move',
      })
      .addTo(this.map);

    this.pin.on('dragend', () => {
      const moved = this.pin?.getLatLng();
      if (moved !== undefined) {
        this.centerChanged.emit({ lat: moved.lat, lng: moved.lng });
      }
    });

    this.map.on('click', (event: L.LeafletMouseEvent) => {
      if (this.interactive()) {
        this.centerChanged.emit({ lat: event.latlng.lat, lng: event.latlng.lng });
      }
    });

    this.applyRadius(this.radiusKm());
    this.applyMarkers(this.markers());
  }

  /* ------------------------------- drawing ------------------------------- */

  private applyCenter(point: { lat: number; lng: number }): void {
    if (this.map === null || this.pin === null) {
      return;
    }
    this.pin.setLatLng([point.lat, point.lng]);
    this.circle?.setLatLng([point.lat, point.lng]);
    this.map.panTo([point.lat, point.lng]);
  }

  private applyRadius(km: number): void {
    const leaflet = this.leaflet;
    if (leaflet === null || this.map === null) {
      return;
    }

    if (km <= 0) {
      this.circle?.remove();
      this.circle = null;
      return;
    }

    const point = this.center();
    const metres = km * 1000;

    if (this.circle === null) {
      this.circle = leaflet
        .circle([point.lat, point.lng], {
          radius: metres,
          color: '#16A34A',
          weight: 2,
          fillColor: '#22C55E',
          fillOpacity: 0.1,
        })
        .addTo(this.map);
    } else {
      this.circle.setRadius(metres);
    }

    // Frame the whole circle so changing the radius shows what it now covers.
    this.map.fitBounds(this.circle.getBounds(), { padding: [24, 24] });
  }

  private applyMarkers(points: readonly MapMarker[]): void {
    const leaflet = this.leaflet;
    if (leaflet === null || this.layer === null) {
      return;
    }

    const wanted = new Set(points.map((point) => point.id));

    for (const [id, marker] of this.drawn) {
      if (!wanted.has(id)) {
        marker.remove();
        this.drawn.delete(id);
      }
    }

    for (const point of points) {
      const existing = this.drawn.get(point.id);
      if (existing !== undefined) {
        existing.setLatLng([point.lat, point.lng]);
        existing.setIcon(this.resultIcon(point));
        existing.setZIndexOffset(point.selected ? 1000 : 0);
        continue;
      }

      const marker = leaflet
        .marker([point.lat, point.lng], {
          icon: this.resultIcon(point),
          title: point.label,
          keyboard: true,
          zIndexOffset: point.selected ? 1000 : 0,
        })
        .addTo(this.layer);

      marker.on('click', () => this.markerClicked.emit(point.id));
      this.drawn.set(point.id, marker);
    }
  }

  /**
   * Icons are `divIcon`s rather than Leaflet's default images.
   *
   * Two reasons: the default icon's URLs break under a bundler, and these
   * inherit the product's colours. Selection is shown by **shape and a tick**,
   * not colour alone.
   */
  private resultIcon(point: MapMarker): L.DivIcon {
    const leaflet = this.leaflet as typeof L;

    const base =
      'display:grid;place-items:center;width:22px;height:22px;border-radius:9999px;' +
      'font:600 11px/1 ui-sans-serif,system-ui;box-shadow:0 1px 3px rgb(15 23 42 / .35);';

    const style = point.muted
      ? `${base}background:#94A3B8;color:#fff;border:2px solid #fff;opacity:.65;`
      : point.selected
        ? `${base}background:#16A34A;color:#fff;border:2px solid #fff;`
        : `${base}background:#fff;color:#334155;border:2px solid #16A34A;`;

    return leaflet.divIcon({
      className: '',
      html: `<span style="${style}" aria-hidden="true">${point.selected ? '✓' : ''}</span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  private pinIcon(): L.DivIcon {
    const leaflet = this.leaflet as typeof L;
    return leaflet.divIcon({
      className: '',
      html:
        '<span style="display:block;width:28px;height:28px;border-radius:9999px 9999px 9999px 2px;' +
        'transform:rotate(-45deg);background:#166534;border:3px solid #fff;' +
        'box-shadow:0 2px 6px rgb(15 23 42 / .45);" aria-hidden="true"></span>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
  }
}
