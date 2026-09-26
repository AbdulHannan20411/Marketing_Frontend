import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

import { IconComponent } from '@shared/ui/icon/icon.component';

let nextId = 0;

/**
 * The search field every list screen was hand-rolling.
 *
 * Same markup each time — a magnifier, a rounded input, a clear button — so it
 * lives here once. Two-way bound through `value`, and the clearing is part of
 * it: a filtered list with no visible way back to the whole list is the small
 * cruelty that makes people reload the page.
 */
@Component({
  selector: 'app-search-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'relative block' },
  template: `
    <label class="sr-only" [attr.for]="inputId">{{ label() }}</label>
    <app-icon
      name="search"
      [size]="15"
      class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
    />
    <input
      [attr.id]="inputId"
      type="search"
      [value]="value()"
      [attr.placeholder]="placeholder()"
      (input)="value.set($any($event.target).value)"
      class="h-9 w-full rounded-lg border-0 bg-surface-sunken py-2 pr-9 pl-9 text-sm text-ink ring-1 ring-line ring-inset transition-all placeholder:text-ink-muted focus:bg-surface focus:ring-2 focus:ring-brand-500 focus:outline-none"
    />
    @if (value() !== '') {
      <button
        type="button"
        class="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        aria-label="Clear search"
        (click)="value.set('')"
      >
        <app-icon name="close" [size]="14" />
      </button>
    }
  `,
})
export class SearchBoxComponent {
  readonly value = model('');
  readonly placeholder = input('Search');
  /** What a screen reader hears; the field itself carries no visible label. */
  readonly label = input('Search');

  protected readonly inputId = `search-box-${nextId++}`;
}
