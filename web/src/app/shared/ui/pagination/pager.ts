import { computed, signal, type Signal } from '@angular/core';

import { DEFAULT_PAGE_SIZE } from './pagination.component';

/**
 * One pagination model for the whole app.
 *
 * Every list screen needs the same four things — which page, how big, how many
 * in total, and how to move — and the difference between a list the API pages
 * and one it returns whole is only *where the slicing happens*. So both are
 * this same object:
 *
 * - {@link clientPager} slices a signal of rows in the browser, for endpoints
 *   that return everything.
 * - {@link serverPager} keeps the page and size and refetches, for endpoints
 *   that take `page` and `pageSize`.
 *
 * A screen then renders `<app-paginator [pager]="pager" />` and nothing else,
 * and `app-data-table` takes the same object. Swapping a list from client to
 * server paging is a one-line change at the top of the component.
 */
export interface Pager {
  readonly page: Signal<number>;
  readonly pageSize: Signal<number>;
  readonly total: Signal<number>;
  readonly totalPages: Signal<number>;
  /** More than one page: the arrows can do something. */
  readonly hasPages: Signal<boolean>;

  /** Go to a page. A server pager refetches. */
  setPage(page: number): void;
  /** Change the rows per page, returning to page one. A server pager refetches. */
  setPageSize(size: number): void;

  /**
   * Back to page one **without** refetching — for a filter, search or sort
   * change, where the screen is about to load anyway and often loads more than
   * the list (counts, summaries). Two requests for one keystroke is worse than
   * one explicit call here.
   */
  reset(): void;
  /**
   * Back one page, without refetching. For deleting the last row on a page:
   * the caller reloads straight after, and would otherwise land on an empty
   * page with a "next" arrow it cannot use.
   */
  stepBack(): void;
}

/** A pager that also holds the rows for the current page. */
export interface ClientPager<T> extends Pager {
  readonly items: Signal<readonly T[]>;
}

function pageCountOf(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, size)));
}

/**
 * Client-side paging for a list the API returns in full — groups, tags,
 * employees, notifications, the platform's admin list.
 *
 * Rendering hundreds of rows at once is what makes those screens slow, and the
 * DOM is the cost, not the request. Where the API *can* page, use
 * {@link serverPager} instead: that saves the transfer too.
 */
export function clientPager<T>(
  source: Signal<readonly T[]>,
  pageSize = DEFAULT_PAGE_SIZE,
): ClientPager<T> {
  const requested = signal(1);
  const size = signal(pageSize);

  const total = computed(() => source().length);
  const totalPages = computed(() => pageCountOf(total(), size()));

  /**
   * Clamped rather than reset: deleting the last row on page 4 should show
   * page 3, not throw the user back to the top of the list.
   */
  const page = computed(() => Math.min(Math.max(1, requested()), totalPages()));

  const items = computed(() => {
    const perPage = Math.max(1, size());
    const start = (page() - 1) * perPage;
    return source().slice(start, start + perPage);
  });

  return {
    page,
    pageSize: size.asReadonly(),
    total,
    totalPages,
    hasPages: computed(() => total() > size()),
    items,
    setPage: (next) => requested.set(next),
    setPageSize: (next) => {
      size.set(next);
      requested.set(1);
    },
    reset: () => requested.set(1),
    // The clamp above already handles a vanished last page; this is here so
    // both pagers answer to the same interface.
    stepBack: () => requested.update((current) => Math.max(1, current - 1)),
  };
}

export interface ServerPagerConfig {
  /** The server's `totalItems`, which the host sets after each fetch. */
  readonly total: Signal<number>;
  readonly pageSize?: number;
  /** Refetch the current page. Called when the page or the size changes. */
  readonly load: () => void;
}

/**
 * Server-side paging: holds the page and size, and refetches when they change.
 *
 * The host owns the rows, because it owns the request — its filters, its
 * loading state and its errors — and reads `pager.page()` and
 * `pager.pageSize()` when it builds the query.
 */
export function serverPager(config: ServerPagerConfig): Pager {
  const page = signal(1);
  const size = signal(config.pageSize ?? DEFAULT_PAGE_SIZE);

  return {
    page: page.asReadonly(),
    pageSize: size.asReadonly(),
    total: config.total,
    totalPages: computed(() => pageCountOf(config.total(), size())),
    hasPages: computed(() => config.total() > size()),
    setPage: (next) => {
      if (next >= 1 && next !== page()) {
        page.set(next);
        config.load();
      }
    },
    setPageSize: (next) => {
      // Back to page one: the row they were looking at is unlikely to be on
      // the current page once the size changes.
      size.set(next);
      page.set(1);
      config.load();
    },
    reset: () => page.set(1),
    stepBack: () => page.update((current) => Math.max(1, current - 1)),
  };
}
