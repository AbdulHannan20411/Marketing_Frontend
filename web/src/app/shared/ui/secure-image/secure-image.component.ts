import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';

import { ApiService } from '@core/services/api.service';
import { IconComponent } from '@shared/ui/icon/icon.component';

/**
 * An image behind the bearer token.
 *
 * A plain `<img src>` cannot send an Authorization header, so anything served
 * by the API has to be fetched as a blob and shown through an object URL. The
 * URL is revoked when the source changes or the component goes away — without
 * that, every proof a reviewer opens leaks a blob for the life of the tab.
 *
 * `data:` and third-party `http(s)` sources are passed straight through, since
 * they carry no credentials and need no fetch.
 */
@Component({
  selector: 'app-secure-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'block' },
  template: `
    @if (failed()) {
      <div
        class="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-surface-sunken p-6 text-center ring-1 ring-line"
      >
        <app-icon name="photo" [size]="22" class="text-ink-muted" />
        <p class="text-xs text-ink-muted">{{ fallback() }}</p>
      </div>
    } @else {
      <!-- An "as" binding is only allowed on a primary @if, so this nests. -->
      @if (resolved(); as url) {
        <img [src]="url" [alt]="alt()" class="h-full w-full object-contain" />
      } @else {
        <div
          class="flex h-full w-full items-center justify-center rounded-lg bg-surface-sunken ring-1 ring-line"
        >
          <app-icon name="refresh" [size]="20" class="animate-spin text-ink-muted" />
        </div>
      }
    }
  `,
})
export class SecureImageComponent {
  readonly src = input.required<string>();
  readonly alt = input('');
  readonly fallback = input('Preview unavailable');

  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly objectUrl = signal<string | null>(null);
  protected readonly failed = signal(false);

  /** Direct sources need no fetch; everything else waits for the blob. */
  private readonly isDirect = computed(() => {
    const value = this.src();
    return value.startsWith('data:') || value.startsWith('blob:');
  });

  protected readonly resolved = computed(() =>
    this.isDirect() ? this.src() : this.objectUrl(),
  );

  constructor() {
    effect(() => {
      const source = this.src();

      untracked(() => {
        this.release();

        // An empty source is a decided absence, not a pending load — showing a
        // spinner for it would wait forever on something that will never arrive.
        this.failed.set(source === '');

        if (source === '' || this.isDirect()) {
          return;
        }

        this.api.downloadAbsolute(source).subscribe({
          next: (blob) => this.objectUrl.set(URL.createObjectURL(blob)),
          error: () => this.failed.set(true),
        });
      });
    });

    this.destroyRef.onDestroy(() => this.release());
  }

  private release(): void {
    const current = this.objectUrl();
    if (current !== null) {
      URL.revokeObjectURL(current);
      this.objectUrl.set(null);
    }
  }
}
