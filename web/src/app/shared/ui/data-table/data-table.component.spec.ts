import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { DataTableComponent, type TableColumn } from './data-table.component';
import { clientSorter, type SortColumn } from './sort';
import { TableRowDirective } from './table-row.directive';

interface Row {
  readonly id: string;
  readonly name: string;
}

const COLUMNS: readonly TableColumn[] = [
  { key: 'id', header: 'ID', sortKey: 'id' },
  { key: 'name', header: 'Name', sortKey: 'name' },
  // No sortKey: an actions column must never become a control.
  { key: 'actions', header: '' },
];

const SORT_COLUMNS: readonly SortColumn<Row>[] = [
  { key: 'id', label: 'ID', kind: 'text', value: (row) => row.id },
  { key: 'name', label: 'Name', kind: 'text', value: (row) => row.name },
];

@Component({
  imports: [DataTableComponent, TableRowDirective],
  template: `
    <app-data-table [columns]="columns" [rows]="sorter.rows()" [sorter]="sorter">
      <ng-template [appTableRow]="sorter.rows()" let-row>
        <td class="id">{{ row.id }}</td>
        <td>{{ row.name }}</td>
        <td></td>
      </ng-template>
    </app-data-table>
  `,
})
class HostComponent {
  readonly columns = COLUMNS;
  readonly source = signal<readonly Row[]>([
    { id: 'ctc_10', name: 'Zoe' },
    { id: 'ctc_2', name: 'Adam' },
  ]);
  readonly sorter = clientSorter(this.source, SORT_COLUMNS);
}

describe('DataTableComponent — sorting', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;

  function headers(): HTMLTableCellElement[] {
    return [...element.querySelectorAll('th')];
  }

  function firstIdCell(): string {
    return element.querySelector('td.id')?.textContent?.trim() ?? '';
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  });

  it('makes a column with a sort key a button, and leaves the others alone', () => {
    expect(headers()[0].querySelector('button')).not.toBeNull();
    expect(headers()[1].querySelector('button')).not.toBeNull();
    // The actions column: no key, no control.
    expect(headers()[2].querySelector('button')).toBeNull();
  });

  it('sorts on click and says so through aria-sort', () => {
    expect(headers()[1].getAttribute('aria-sort')).toBe('none');

    headers()[1].querySelector('button')!.click();
    fixture.detectChanges();

    expect(headers()[1].getAttribute('aria-sort')).toBe('ascending');
    expect(firstIdCell()).toBe('ctc_2'); // Adam

    headers()[1].querySelector('button')!.click();
    fixture.detectChanges();

    expect(headers()[1].getAttribute('aria-sort')).toBe('descending');
    expect(firstIdCell()).toBe('ctc_10'); // Zoe
  });

  it('orders ids by their number rather than their text', () => {
    headers()[0].querySelector('button')!.click();
    fixture.detectChanges();

    // Text ordering would put ctc_10 before ctc_2.
    expect(firstIdCell()).toBe('ctc_2');
  });
});
