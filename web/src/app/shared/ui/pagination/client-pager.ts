import { computed, signal, type Signal } from '@angular/core';

import { DEFAULT_PAGE_SIZE } from './pagination.component';

/**
 * Client-side paging for a list the API returns in full.
 *
 * Several endpoints — groups, tags, employees, notifications, the platform's
 * admin list — hand back every row. Rendering hundreds of cards at once is
 * what makes those screens slow, and the DOM is the cost, not the request. This
 * slices the list so only one page is rendered; the rest stays in memory.
 *
 * Where the API can page (contacts, campaigns, templates, audit) it still
 * should: that saves the transfer as well. This is for the rest.
 */
export interface ClientPager<T> {
  /** The page being shown, already clamped to the list's length. */
  readonly page: Signal<number>;
  readonly pageSize: Signal<number>;
  readonly total: Signal<number>;
  readonly items: Signal<readonly T[]>;
  /** True when there is more than one page, so the control is worth showing. */
  readonly hasPages: Signal<boolean>;
  setPage(page: number): void;
  setPageSize(size: number): void;
  /** Back to the first page — call when a filter or search changes. */
  first(): void;
}

export function clientPager<T>(source: Signal<readonly T[]>, initialSize = DEFAULT_PAGE_SIZE): ClientPager<T> {
  const requested = signal(1);
  const pageSize = signal(initialSize);

  const total = computed(() => source().length);
  const pageCount = computed(() => Math.max(1, Math.ceil(total() / Math.max(1, pageSize()))));

  /**
   * Clamped rather than reset: deleting the last row on page 4 should show
   * page 3, not throw the user back to the top of the list.
   */
  const page = computed(() => Math.min(Math.max(1, requested()), pageCount()));

  const items = computed(() => {
    const size = Math.max(1, pageSize());
    const start = (page() - 1) * size;
    return source().slice(start, start + size);
  });

  return {
    page,
    pageSize: pageSize.asReadonly(),
    total,
    items,
    hasPages: computed(() => total() > pageSize()),
    setPage: (next) => requested.set(next),
    setPageSize: (size) => {
      pageSize.set(size);
      requested.set(1);
    },
    first: () => requested.set(1),
  };
}
