import { Directive, TemplateRef, inject, input } from '@angular/core';

export interface TableRowContext<TRow> {
  readonly $implicit: TRow;
}

/**
 * Types the projected row template. Bind the same collection the table renders
 * (`<ng-template [appTableRow]="contacts()" let-contact>`) and the context guard
 * infers `let-contact` as the row type instead of falling back to `any`.
 *
 * The input is used purely for inference — the directive never reads it.
 */
@Directive({ selector: 'ng-template[appTableRow]' })
export class TableRowDirective<TRow> {
  readonly appTableRow = input.required<readonly TRow[]>();
  readonly template = inject<TemplateRef<TableRowContext<TRow>>>(TemplateRef);

  static ngTemplateContextGuard<TRow>(
    _directive: TableRowDirective<TRow>,
    _context: unknown,
  ): _context is TableRowContext<TRow> {
    return true;
  }
}
