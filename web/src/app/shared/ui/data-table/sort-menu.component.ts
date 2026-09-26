import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { IconComponent } from '@shared/ui/icon/icon.component';
import type { Sorter } from './sort';

let nextId = 0;

/**
 * Sort control for a list that has no column headers to click.
 *
 * Several screens list entities as cards or rows rather than a table — groups,
 * tags, employees, plans. They need the same ordering as the tables, and a
 * `<select>` plus a direction button is the honest control for a list with no
 * header row, rather than inventing a fake one.
 *
 * Pairs with the same {@link Sorter} the tables use, so a screen that later
 * becomes a table keeps its ordering unchanged.
 */
@Component({
  selector: 'app-sort-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'inline-flex items-center gap-1.5' },
  template: `
    <label class="sr-only" [attr.for]="selectId">Sort by</label>
    <select
      [attr.id]="selectId"
      [value]="sorter().key() ?? ''"
      (change)="pick($any($event.target).value)"
      class="h-9 rounded-lg border-0 bg-surface px-3 text-sm text-ink-soft ring-1 ring-line ring-inset transition-all focus:ring-2 focus:ring-brand-500 focus:outline-none"
    >
      <option value="">{{ defaultLabel() }}</option>
      @for (column of sorter().columns; track column.key) {
        <option [value]="column.key">{{ column.label }}</option>
      }
    </select>

    <button
      type="button"
      class="grid h-9 w-9 place-items-center rounded-lg bg-surface text-ink-soft ring-1 ring-line ring-inset transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40 disabled:hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
      [disabled]="sorter().key() === null"
      [attr.aria-label]="directionLabel()"
      (click)="flip()"
    >
      <app-icon [name]="sorter().direction() === 'desc' ? 'chevronDown' : 'chevronUp'" [size]="15" />
    </button>
  `,
})
export class SortMenuComponent {
  readonly sorter = input.required<Sorter>();
  /** What the unsorted option is called — "Newest first", "Default order". */
  readonly defaultLabel = input('Default order');

  protected readonly selectId = `sort-menu-${nextId++}`;

  protected readonly directionLabel = computed(() =>
    this.sorter().direction() === 'asc'
      ? 'Sorted ascending. Switch to descending.'
      : 'Sorted descending. Switch to ascending.',
  );

  protected pick(key: string): void {
    const sorter = this.sorter();
    if (key === '') {
      sorter.set(null);
      return;
    }
    // Through `toggle`, so choosing a column applies that column's own
    // starting direction — newest first for a date, A–Z for a name.
    sorter.set(key, directionFor(sorter, key));
  }

  protected flip(): void {
    const sorter = this.sorter();
    const key = sorter.key();
    if (key !== null) {
      sorter.set(key, sorter.direction() === 'asc' ? 'desc' : 'asc');
    }
  }
}

function directionFor(sorter: Sorter, key: string): 'asc' | 'desc' {
  return sorter.columns.find((column) => column.key === key)?.initialDirection ?? 'asc';
}
