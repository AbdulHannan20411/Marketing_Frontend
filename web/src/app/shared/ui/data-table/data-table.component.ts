import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import type { LoadState } from '@core/models/api.model';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import {
  DEFAULT_PAGE_SIZE,
  PaginationComponent,
} from '@shared/ui/pagination/pagination.component';
import type { Pager } from '@shared/ui/pagination/pager';
import { TableRowDirective } from './table-row.directive';

/**
 * What makes a row the same row between two renders.
 *
 * Every record in this app carries an `id`; the index is the fallback for a
 * row that genuinely has no identity of its own.
 */
function rowIdentity(row: unknown, index: number): unknown {
  return (row as { id?: unknown } | null)?.id ?? index;
}

export interface TableColumn {
  readonly key: string;
  readonly header: string;
  readonly align?: 'left' | 'center' | 'right';
  /** Tailwind width utility, e.g. `w-40`. Omit to let the column size itself. */
  readonly widthClass?: string;
  /** Hidden below the `md` breakpoint so narrow screens stay readable. */
  readonly hideOnMobile?: boolean;
}

/**
 * Enterprise table shell: owns the toolbar, header, states and pagination.
 * Rows are projected via `<ng-template #rowTemplate let-row>` so each feature
 * keeps full control of its cells without a cell-renderer abstraction.
 */
@Component({
  selector: 'app-data-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    IconComponent,
    SkeletonComponent,
    ButtonDirective,
    PaginationComponent,
  ],
  templateUrl: './data-table.component.html',
  host: { class: 'block' },
})
export class DataTableComponent<TRow> {
  readonly columns = input.required<readonly TableColumn[]>();
  readonly rows = input.required<readonly TRow[]>();
  /**
   * How a row is identified across renders.
   *
   * Rows were tracked by index, which is wrong for a table whose contents
   * move: deleting a row, paging, sorting or filtering shifts everything up
   * an index, so Angular reuses each `<tr>` for a *different* record. Every
   * row is then re-rendered rather than moved, and anything living inside one
   * — focus, an open menu, a half-typed inline edit — stays behind on
   * whatever record took that position.
   */
  readonly trackBy = input<(row: TRow, index: number) => unknown>(rowIdentity);
  readonly state = input<LoadState>('ready');
  /**
   * The table's pagination, as one object — see `pager.ts`. Preferred over the
   * three inputs below, which remain for callers that own the numbers
   * themselves.
   */
  readonly pager = input<Pager | null>(null);
  readonly page = input(1);
  readonly pageSize = input(DEFAULT_PAGE_SIZE);
  readonly totalItems = input(0);
  readonly showPageSize = input(true);
  readonly emptyTitle = input('Nothing here yet');
  readonly emptyDescription = input('Once records exist they will appear in this table.');

  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly retry = output<void>();

  /** Drives the pager when there is one; otherwise the host hears about it. */
  protected onPageChange(page: number): void {
    const pager = this.pager();
    if (pager === null) {
      this.pageChange.emit(page);
      return;
    }
    pager.setPage(page);
  }

  protected onPageSizeChange(size: number): void {
    const pager = this.pager();
    if (pager === null) {
      this.pageSizeChange.emit(size);
      return;
    }
    pager.setPageSize(size);
  }

  /** The pager's numbers when there is one, the plain inputs otherwise. */
  protected readonly activePage = computed(() => this.pager()?.page() ?? this.page());
  protected readonly activePageSize = computed(() => this.pager()?.pageSize() ?? this.pageSize());
  protected readonly activeTotal = computed(() => this.pager()?.total() ?? this.totalItems());

  private readonly rowDirective = contentChild.required(TableRowDirective);
  protected readonly rowTemplate = computed(() => this.rowDirective().template);

  /** Placeholder rows while loading; roughly a screenful. */
  protected readonly skeletonRows = computed(() => Array.from({ length: 6 }, (_, i) => i));

  protected alignClass(column: TableColumn): string {
    switch (column.align) {
      case 'right':
        return 'text-right';
      case 'center':
        return 'text-center';
      default:
        return 'text-left';
    }
  }

}
