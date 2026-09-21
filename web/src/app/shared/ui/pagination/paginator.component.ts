import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { PaginationComponent } from './pagination.component';
import type { Pager } from './pager';

/**
 * The pagination control, driven by a {@link Pager}.
 *
 * This is what a list screen renders: one line, and the same line whether the
 * rows are paged by the API or sliced in the browser.
 *
 * **Shown whenever there is at least one row**, with the arrows disabled on a
 * single page — the same rule `app-data-table` already follows. Hiding it below
 * one page is tempting, but then "1–8 of 8" and the per-page control disappear
 * too, and a screen that shows no pagination at all reads as one where it is
 * broken rather than unnecessary.
 */
@Component({
  selector: 'app-paginator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [PaginationComponent],
  template: `
    @if (visible()) {
      <app-pagination
        [page]="pager().page()"
        [pageSize]="pager().pageSize()"
        [totalItems]="pager().total()"
        [showPageSize]="showPageSize()"
        (pageChange)="pager().setPage($event)"
        (pageSizeChange)="pager().setPageSize($event)"
      />
    }
  `,
})
export class PaginatorComponent {
  readonly pager = input.required<Pager>();
  readonly showPageSize = input(true);
  /** Set for a short list where even the range line would be noise. */
  readonly hideOnSinglePage = input(false);

  protected readonly visible = computed(() => {
    const pager = this.pager();
    return pager.total() > 0 && (!this.hideOnSinglePage() || pager.hasPages());
  });
}
