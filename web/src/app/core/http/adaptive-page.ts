import type { PagedResult } from '@core/models/api.model';

/** What a list screen asks for. The same shape every paged endpoint takes. */
export interface ListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly sortBy?: string | null;
  readonly sortDirection?: 'asc' | 'desc';
}

export interface AdaptivePage<T> extends PagedResult<T> {
  /**
   * Whether the API did the filtering, ordering and slicing.
   *
   * False means the endpoint still answers with the whole collection and this
   * page was cut from it here — correct, but it does not scale, and the screen
   * can say so where the difference matters.
   */
  readonly pagedByServer: boolean;
}

export interface AdaptOptions<T> {
  /**
   * Does this row belong in the result? Only used for a client-side page.
   *
   * Called for every row, including when the term is empty, because a screen's
   * own filters — a status, a tab — have to be applied here too, and they
   * apply whether or not anything has been typed.
   */
  readonly matches?: (row: T, term: string) => boolean;
  /** Orders the whole collection before it is sliced, for a client-side page. */
  readonly compare?: (query: ListQuery) => ((left: T, right: T) => number) | null;
}

/**
 * Turns whatever a list endpoint answers into one page.
 *
 * Every list screen in this app is written as though the API pages, searches
 * and sorts — because that is what they should do, and several already do. The
 * ones that still answer with the whole collection are adapted here instead of
 * in the screen: the same filter, the same order, the same slice, applied in
 * the browser.
 *
 * Two things follow from putting it here rather than in each component:
 *
 * - **Nothing changes on the screen when an endpoint starts paging.** The
 *   component already asks for page three and reads `totalItems`; the day the
 *   API answers a `PagedResult` this simply stops slicing.
 * - **The filtering and ordering cannot drift apart.** A screen that filtered
 *   locally and asked the server to sort would show the first page of one
 *   ordering filtered by another.
 *
 * `pagedByServer` is the honest flag underneath: a screen that needs to know —
 * to disable a sort the API cannot do, or to warn about a slow list — can ask.
 */
export function toAdaptivePage<T>(
  response: PagedResult<T> | readonly T[],
  query: ListQuery,
  options: AdaptOptions<T> = {},
): AdaptivePage<T> {
  if (!Array.isArray(response)) {
    return { ...(response as PagedResult<T>), pagedByServer: true };
  }

  const all = response as readonly T[];
  const term = (query.search ?? '').trim().toLowerCase();

  const matches = options.matches;
  const matched = matches === undefined ? all : all.filter((row) => matches(row, term));

  const comparator = options.compare?.(query) ?? null;
  const ordered = comparator === null ? matched : [...matched].sort(comparator);

  const pageSize = Math.max(1, query.pageSize);
  const start = (Math.max(1, query.page) - 1) * pageSize;

  return {
    items: ordered.slice(start, start + pageSize),
    page: query.page,
    pageSize,
    totalItems: ordered.length,
    totalPages: Math.max(1, Math.ceil(ordered.length / pageSize)),
    pagedByServer: false,
  };
}
