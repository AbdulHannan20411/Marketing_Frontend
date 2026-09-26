import { signal } from '@angular/core';

import {
  clientSorter,
  rowComparator,
  serverSorter,
  sortParams,
  type SortColumn,
} from './sort';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly createdAt: string | null;
}

const COLUMNS: readonly SortColumn<Row>[] = [
  { key: 'id', label: 'ID', kind: 'text', value: (row) => row.id },
  { key: 'name', label: 'Name', kind: 'text', value: (row) => row.name },
  { key: 'size', label: 'Size', kind: 'number', value: (row) => row.size },
  {
    key: 'createdAt',
    label: 'Created',
    kind: 'date',
    value: (row) => row.createdAt,
    initialDirection: 'desc',
  },
];

function row(id: string, name: string, size: number, createdAt: string | null): Row {
  return { id, name, size, createdAt };
}

describe('sorting', () => {
  describe('data types', () => {
    it('orders ids by their number, not their text', () => {
      // The classic: 1, 10, 100, 2 — what plain string ordering produces and
      // what everybody reads as a broken list.
      const rows = signal([row('ctc_100', 'C', 1, null), row('ctc_2', 'B', 1, null), row('ctc_10', 'A', 1, null)]);
      const sorter = clientSorter(rows, COLUMNS);

      sorter.set('id', 'asc');

      expect(sorter.rows().map((entry) => entry.id)).toEqual(['ctc_2', 'ctc_10', 'ctc_100']);
    });

    it('orders dates chronologically, not by their rendered text', () => {
      const rows = signal([
        row('a', 'A', 1, '2026-02-10T00:00:00Z'),
        row('b', 'B', 1, '2025-12-20T00:00:00Z'),
        row('c', 'C', 1, '2026-01-02T00:00:00Z'),
      ]);
      const sorter = clientSorter(rows, COLUMNS);

      sorter.set('createdAt', 'asc');

      expect(sorter.rows().map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
    });

    it('orders numbers numerically', () => {
      const rows = signal([row('a', 'A', 9, null), row('b', 'B', 81, null), row('c', 'C', 100, null)]);
      const sorter = clientSorter(rows, COLUMNS);

      sorter.set('size', 'desc');

      expect(sorter.rows().map((entry) => entry.size)).toEqual([100, 81, 9]);
    });
  });

  describe('missing values', () => {
    it('keeps empty values last in both directions', () => {
      // A record that has never been modified has no modified date. Those rows
      // belong at the end either way round — otherwise "sort by Modified"
      // fills the first page with blanks.
      const rows = signal([
        row('a', 'A', 1, null),
        row('b', 'B', 1, '2026-01-01T00:00:00Z'),
        row('c', 'C', 1, '2026-02-01T00:00:00Z'),
      ]);
      const sorter = clientSorter(rows, COLUMNS);

      sorter.set('createdAt', 'asc');
      expect(sorter.rows().map((entry) => entry.id)).toEqual(['b', 'c', 'a']);

      sorter.set('createdAt', 'desc');
      expect(sorter.rows().map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
    });

    it('treats an empty string as missing, not as the first value', () => {
      const compare = rowComparator(COLUMNS[1], 'asc');
      expect(compare(row('a', '', 1, null), row('b', 'Zeta', 1, null))).toBeGreaterThan(0);
    });
  });

  describe('the control', () => {
    it('cycles sort, reverse, off', () => {
      const rows = signal([row('a', 'B', 1, null), row('b', 'A', 1, null)]);
      const sorter = clientSorter(rows, COLUMNS);

      sorter.toggle('name');
      expect(sorter.direction()).toBe('asc');

      sorter.toggle('name');
      expect(sorter.direction()).toBe('desc');

      // A third click returns the list to its natural order — otherwise there
      // is no way back to it once a column has been clicked.
      sorter.toggle('name');
      expect(sorter.key()).toBeNull();
      expect(sorter.rows().map((entry) => entry.id)).toEqual(['a', 'b']);
    });

    it('starts a date column at newest first', () => {
      const rows = signal<readonly Row[]>([]);
      const sorter = clientSorter(rows, COLUMNS);

      sorter.toggle('createdAt');

      expect(sorter.direction()).toBe('desc');
    });

    it('ignores a column it was not given', () => {
      const rows = signal([row('a', 'A', 1, null)]);
      const sorter = clientSorter(rows, COLUMNS);

      sorter.toggle('actions');

      expect(sorter.key()).toBeNull();
      expect(sorter.isSortable('actions')).toBeFalse();
    });

    it('reports the direction for aria-sort', () => {
      const sorter = clientSorter(signal<readonly Row[]>([]), COLUMNS);

      expect(sorter.ariaSort('name')).toBe('none');
      sorter.set('name', 'desc');
      expect(sorter.ariaSort('name')).toBe('descending');
      expect(sorter.ariaSort('size')).toBe('none');
    });

    it('leaves the source array untouched', () => {
      const source = [row('a', 'B', 1, null), row('b', 'A', 1, null)];
      const rows = signal<readonly Row[]>(source);
      const sorter = clientSorter(rows, COLUMNS);

      sorter.set('name', 'asc');
      sorter.rows();

      expect(source.map((entry) => entry.id)).toEqual(['a', 'b']);
    });
  });

  describe('sortParams', () => {
    it('sends nothing at all when the list is in its natural order', () => {
      expect(sortParams(null)).toEqual({});
      expect(sortParams(undefined, 'desc')).toEqual({});
      // Empty rather than absent would be a key the allow-list does not hold.
      expect(sortParams('')).toEqual({});
    });

    it('spells the direction out in full', () => {
      // The API accepts `desc` too, but a direction it cannot parse is now a
      // 400 — and the long form is the one every endpoint has always taken.
      expect(sortParams('createdAt', 'desc')).toEqual({
        sortBy: 'createdAt',
        sortDirection: 'descending',
      });
      expect(sortParams('name')).toEqual({ sortBy: 'name', sortDirection: 'ascending' });
    });
  });

  describe('serverSorter', () => {
    it('refetches when the sort changes, and not when it does not', () => {
      const load = jasmine.createSpy('load');
      const sorter = serverSorter({
        columns: [{ key: 'fullName', label: 'Name' }],
        load,
      });

      sorter.toggle('fullName');
      expect(load).toHaveBeenCalledTimes(1);

      // Not in the allow-list: no state change, so no request.
      sorter.toggle('nonsense');
      expect(load).toHaveBeenCalledTimes(1);
    });
  });
});
