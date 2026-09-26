import { toAdaptivePage } from './adaptive-page';

interface Row {
  readonly id: number;
  readonly name: string;
}

const ALL: readonly Row[] = [
  { id: 1, name: 'Delta' },
  { id: 2, name: 'Alpha' },
  { id: 3, name: 'Charlie' },
  { id: 4, name: 'Bravo' },
  { id: 5, name: 'alpine' },
];

/**
 * The point of the adapter: a screen written for a paged API keeps working
 * against one that is not yet, and switches with no change when it is.
 */
describe('toAdaptivePage', () => {
  it('passes a server page straight through', () => {
    const page = toAdaptivePage(
      { items: [ALL[0]], page: 2, pageSize: 1, totalItems: 5, totalPages: 5 },
      { page: 2, pageSize: 1 },
    );

    expect(page.pagedByServer).toBeTrue();
    expect(page.totalItems).toBe(5);
    expect(page.items).toEqual([ALL[0]]);
  });

  it('slices a whole collection into the page that was asked for', () => {
    const page = toAdaptivePage(ALL, { page: 2, pageSize: 2 });

    expect(page.pagedByServer).toBeFalse();
    expect(page.items.map((row) => row.id)).toEqual([3, 4]);
    // The total describes the collection, not the page — the pager depends on
    // it to know there is a page three.
    expect(page.totalItems).toBe(5);
    expect(page.totalPages).toBe(3);
  });

  it('filters before it slices', () => {
    // Filtering afterwards would return two rows out of a page of two and
    // report a total describing rows it had already removed.
    const page = toAdaptivePage(ALL, { page: 1, pageSize: 10, search: 'al' }, {
      matches: (row, term) => row.name.toLowerCase().includes(term),
    });

    expect(page.items.map((row) => row.name)).toEqual(['Alpha', 'alpine']);
    expect(page.totalItems).toBe(2);
  });

  it('applies a screen filter even with nothing typed', () => {
    // A status tab is a filter too, and it applies whether or not the search
    // box has anything in it.
    const page = toAdaptivePage(ALL, { page: 1, pageSize: 10 }, {
      matches: (row) => row.id > 3,
    });

    expect(page.totalItems).toBe(2);
  });

  it('orders the whole collection before slicing it', () => {
    const page = toAdaptivePage(ALL, { page: 1, pageSize: 2, sortBy: 'name' }, {
      compare: () => (left, right) => left.name.localeCompare(right.name),
    });

    // Sorting the page instead would have ordered rows 1 and 2 — Delta and
    // Alpha — and called it the first page of an alphabetical list.
    expect(page.items.map((row) => row.name)).toEqual(['Alpha', 'alpine']);
  });

  it('never leaves the caller on an empty page it cannot understand', () => {
    const page = toAdaptivePage(ALL, { page: 1, pageSize: 0 });

    expect(page.pageSize).toBe(1);
    expect(page.items.length).toBe(1);
  });
});
