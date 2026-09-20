import { signal } from '@angular/core';

import { clientPager } from './client-pager';

describe('clientPager', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

  it('slices the source into pages', () => {
    const source = signal(rows(25));
    const pager = clientPager(source, 10);

    expect(pager.items()).toEqual(rows(10));
    expect(pager.total()).toBe(25);
    expect(pager.hasPages()).toBeTrue();

    pager.setPage(3);
    expect(pager.items()).toEqual([21, 22, 23, 24, 25]);
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

  it('returns to the first page when the page size changes or a filter asks', () => {
    const pager = clientPager(signal(rows(100)), 10);
    pager.setPage(5);
    pager.setPageSize(50);
    expect(pager.page()).toBe(1);
    expect(pager.items().length).toBe(50);

    pager.setPage(2);
    pager.first();
    expect(pager.page()).toBe(1);
  });

  it('handles an empty list', () => {
    const pager = clientPager(signal<number[]>([]), 10);
    expect(pager.items()).toEqual([]);
    expect(pager.page()).toBe(1);
    expect(pager.hasPages()).toBeFalse();
  });
});
