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
import { TableRowDirective } from './table-row.directive';

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
  readonly state = input<LoadState>('ready');
  readonly page = input(1);
  readonly pageSize = input(DEFAULT_PAGE_SIZE);
  readonly totalItems = input(0);
  readonly showPageSize = input(true);
  readonly emptyTitle = input('Nothing here yet');
  readonly emptyDescription = input('Once records exist they will appear in this table.');

  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly retry = output<void>();

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
