import { pagingParams, toAdaptivePage } from './adaptive-page';

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

  it('hands back the whole collection only when the endpoint sent one', () => {
    // A screen whose header counts describe every row ("12 plans, 8 active")
    // can answer them for free while the endpoint still returns everything —
    // and gets `null`, rather than a wrong number, the day it pages.
    expect(toAdaptivePage(ALL, { page: 1, pageSize: 2 }).all).toEqual(ALL);
    expect(
      toAdaptivePage({ items: [], page: 1, pageSize: 2, totalItems: 5, totalPages: 3 }, {
        page: 1,
        pageSize: 2,
      }).all,
    ).toBeNull();
  });

  it('never leaves the caller on an empty page it cannot understand', () => {
    const page = toAdaptivePage(ALL, { page: 1, pageSize: 0 });

    expect(page.pageSize).toBe(1);
    expect(page.items.length).toBe(1);
  });
});

/**
 * Reported as "search in Tags and Groups is not working". `/groups` pages but
 * ignores `search`, so asking for a page of a search returned the first
 * twenty-five of everything — and the client, holding only those, had no way
 * to filter its way back to the right answer.
 */
describe('pagingParams', () => {
  const FULL = { search: true, sort: true };
  const NEITHER = { search: false, sort: false };

  it('asks for a page when the endpoint can answer the whole question', () => {
    expect(pagingParams({ page: 2, pageSize: 25, search: 'win', sortBy: 'name' }, FULL)).toEqual({
      page: 2,
      pageSize: 25,
    });
  });

  it('asks for a page when there is nothing to search or sort', () => {
    expect(pagingParams({ page: 2, pageSize: 25 }, NEITHER)).toEqual({ page: 2, pageSize: 25 });
    // An empty term is not a search.
    expect(pagingParams({ page: 1, pageSize: 25, search: '  ' }, NEITHER)).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it('asks for the whole collection when the endpoint would ignore the search', () => {
    expect(pagingParams({ page: 1, pageSize: 25, search: 'win' }, NEITHER)).toEqual({});
  });

  it('asks for the whole collection when the endpoint would ignore the sort', () => {
    // An endpoint that searches but does not sort — `/superadmin/admins`.
    expect(
      pagingParams({ page: 1, pageSize: 25, sortBy: 'contactCount' }, { search: true, sort: false }),
    ).toEqual({});
    // …and still pages a plain search, which is the common case there.
    expect(
      pagingParams({ page: 3, pageSize: 25, search: 'acme' }, { search: true, sort: false }),
    ).toEqual({ page: 3, pageSize: 25 });
  });
});
