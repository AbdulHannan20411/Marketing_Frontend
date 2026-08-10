import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { IconComponent } from '@shared/ui/icon/icon.component';

/** Offered in the records-per-page control. */
export const PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50];

/** Every list view starts here. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Pagination for a list view: a records-per-page control on one side, and
 * previous / page / next on the other.
 *
 * Purely presentational — it reports intent and lets the host decide whether to
 * refetch or slice in memory. Changing the page size emits `pageSizeChange`
 * only; the host is responsible for returning to page 1, since the row it was
 * showing is unlikely to still be on the current page afterwards.
 */
@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, IconComponent],
  host: { class: 'block' },
  templateUrl: './pagination.component.html',
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly totalItems = input.required<number>();
  readonly pageSizeOptions = input<readonly number[]>(PAGE_SIZE_OPTIONS);
  /** Hidden when a view has no meaningful size choice. */
  readonly showPageSize = input(true);

  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / Math.max(1, this.pageSize()))),
  );

  protected readonly rangeStart = computed(() =>
    this.totalItems() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );

  protected readonly rangeEnd = computed(() =>
    Math.min(this.page() * this.pageSize(), this.totalItems()),
  );

  protected readonly isFirst = computed(() => this.page() <= 1);
  protected readonly isLast = computed(() => this.page() >= this.totalPages());

  protected goTo(page: number): void {
    if (page >= 1 && page <= this.totalPages() && page !== this.page()) {
      this.pageChange.emit(page);
    }
  }

  protected onPageSizeChange(value: string): void {
    const size = Number(value);
    if (Number.isFinite(size) && size > 0 && size !== this.pageSize()) {
      this.pageSizeChange.emit(size);
    }
  }
}
