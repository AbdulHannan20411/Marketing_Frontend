import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { IconComponent } from '@shared/ui/icon/icon.component';
import type { Sorter } from './sort';

/**
 * A sortable column header.
 *
 * One affordance for every table in the app, whether the rows come from
 * `app-data-table` or from a hand-written `<table>`: the whole header is a
 * button, the arrow shows the direction, and the arrow is faint until the
 * column is the one being sorted. Put it inside the `<th>` and set `aria-sort`
 * on the `<th>` itself — that is the cell's attribute, not the button's.
 *
 * Renders plain text when it is given no sorter, or a key the sorter does not
 * accept, so a list that cannot be ordered by a column shows a label rather
 * than a control that does nothing.
 */
@Component({
  selector: 'app-sort-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'contents' },
  template: `
    @if (sortable()) {
      <button
        type="button"
        class="group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
        [class.text-brand-700]="active()"
        [attr.aria-label]="label()"
        (click)="sorter()!.toggle(sortKey())"
      >
        <ng-content />
        <app-icon
          [name]="direction() === 'desc' ? 'chevronDown' : 'chevronUp'"
          [size]="12"
          class="shrink-0 transition-opacity"
          [class.opacity-0]="!active()"
          [class.group-hover:opacity-40]="!active()"
        />
      </button>
    } @else {
      <ng-content />
    }
  `,
})
export class SortHeaderComponent {
  readonly sorter = input<Sorter | null>(null);
  readonly sortKey = input.required<string>();
  /** Spoken label, e.g. "Sort by Created". Falls back to the projected text. */
  readonly headerLabel = input<string | null>(null);

  protected readonly sortable = computed(() => {
    const sorter = this.sorter();
    return sorter !== null && sorter.isSortable(this.sortKey());
  });

  protected readonly active = computed(() => this.sorter()?.key() === this.sortKey());
  protected readonly direction = computed(() =>
    this.active() ? this.sorter()?.direction() : undefined,
  );

  protected readonly label = computed(() => {
    const name = this.headerLabel();
    if (name === null) {
      return null;
    }
    if (!this.active()) {
      return `Sort by ${name}`;
    }
    return this.direction() === 'asc'
      ? `Sorted by ${name}, ascending. Click to reverse.`
      : `Sorted by ${name}, descending. Click to clear.`;
  });
}
