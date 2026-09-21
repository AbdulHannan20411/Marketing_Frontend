import { signal } from '@angular/core';

import { clientPager, serverPager } from './pager';

const rows = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe('clientPager', () => {
  it('slices the source into pages', () => {
    const pager = clientPager(signal(rows(25)), 10);

    expect(pager.items()).toEqual(rows(10));
    expect(pager.total()).toBe(25);
    expect(pager.totalPages()).toBe(3);
    expect(pager.hasPages()).toBeTrue();

    pager.setPage(3);
    expect(pager.items()).toEqual([21, 22, 23, 24, 25]);
  });

  it('defaults to ten per page, so a list of eight is a single page', () => {
    const pager = clientPager(signal(rows(8)));

    expect(pager.pageSize()).toBe(10);
    expect(pager.totalPages()).toBe(1);
    expect(pager.hasPages()).toBeFalse();
    expect(pager.items().length).toBe(8);
  });

  it('follows the source as it changes', () => {
    const source = signal(rows(12));
    const pager = clientPager(source, 10);
    source.set(rows(4));
    expect(pager.items()).toEqual(rows(4));
    expect(pager.hasPages()).toBeFalse();
  });

  it('steps back a page when the last rows on it are gone, rather than resetting', () => {
    const source = signal(rows(21));
    const pager = clientPager(source, 10);
    pager.setPage(3);
    expect(pager.page()).toBe(3);

    source.set(rows(20));
    expect(pager.page()).toBe(2);
    expect(pager.items()).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('returns to the first page when the size changes or a filter asks', () => {
    const pager = clientPager(signal(rows(100)), 10);
    pager.setPage(5);
    pager.setPageSize(50);
    expect(pager.page()).toBe(1);
    expect(pager.items().length).toBe(50);

    pager.setPage(2);
    pager.reset();
    expect(pager.page()).toBe(1);
  });

  it('handles an empty list', () => {
    const pager = clientPager(signal<number[]>([]), 10);
    expect(pager.items()).toEqual([]);
    expect(pager.page()).toBe(1);
    expect(pager.totalPages()).toBe(1);
    expect(pager.hasPages()).toBeFalse();
  });
});

describe('serverPager', () => {
  function setup(total = 95, pageSize?: number) {
    const loads: { page: number; pageSize: number }[] = [];
    const pager = serverPager({
      total: signal(total),
      pageSize,
      load: () => loads.push({ page: pager.page(), pageSize: pager.pageSize() }),
    });
    return { pager, loads };
  }

  it('does not fetch on creation — the screen does its own first load', () => {
    const { loads } = setup();
    expect(loads).toEqual([]);
  });

  it('refetches when the page changes, and ignores a move to the same page', () => {
    const { pager, loads } = setup();

    pager.setPage(3);
    expect(pager.page()).toBe(3);
    expect(loads).toEqual([{ page: 3, pageSize: 10 }]);

    pager.setPage(3);
    expect(loads.length).toBe(1);
  });

  it('returns to page one and refetches when the size changes', () => {
    const { pager, loads } = setup();
    pager.setPage(4);
    pager.setPageSize(50);

    expect(pager.page()).toBe(1);
    expect(pager.pageSize()).toBe(50);
    expect(loads.at(-1)).toEqual({ page: 1, pageSize: 50 });
  });

  it('resets and steps back without fetching, because the caller is about to', () => {
    const { pager, loads } = setup();
    pager.setPage(4);
    loads.length = 0;

    pager.reset();
    expect(pager.page()).toBe(1);
    expect(loads).toEqual([]);

    pager.setPage(3);
    loads.length = 0;
    pager.stepBack();
    expect(pager.page()).toBe(2);
    expect(loads).toEqual([]);
  });

  it('never goes below page one', () => {
    const { pager } = setup();
    pager.stepBack();
    pager.setPage(0);
    expect(pager.page()).toBe(1);
  });

  it('reports the page count from the server total', () => {
    const { pager } = setup(95, 20);
    expect(pager.totalPages()).toBe(5);
    expect(pager.hasPages()).toBeTrue();
  });
});
