import { computed, signal, type Signal } from '@angular/core';

export type SortDirection = 'asc' | 'desc';

/**
 * How a column's values compare.
 *
 * Declared rather than sniffed from the data: a date arrives as a string, a
 * status as a string, and an id as `ctc_12` — sorting all three as plain text
 * is how a list ends up ordered `1, 10, 100, 2` or alphabetically by month
 * name. See {@link compareValues}.
 */
export type SortValueKind = 'text' | 'number' | 'date' | 'boolean';

export interface SortColumn<T> {
  /**
   * Stable identifier for the column.
   *
   * For a server-sorted list this is the API's own sort key, so the allow-list
   * on the server and the header on the screen cannot drift apart.
   */
  readonly key: string;
  /** Human label, for the sort control on screens that are not tables. */
  readonly label: string;
  readonly kind: SortValueKind;
  /** Reads the raw value — never the formatted one. */
  readonly value: (row: T) => unknown;
  /**
   * Direction the first click applies. Dates default to newest first, because
   * "when was this last touched" is almost always the question being asked.
   */
  readonly initialDirection?: SortDirection;
}

/** A column a server sorts, where the client only holds the key and the label. */
export interface ServerSortColumn {
  readonly key: string;
  readonly label: string;
  readonly initialDirection?: SortDirection;
}

export interface Sorter {
  /** The column being sorted by, or null for the list's natural order. */
  readonly key: Signal<string | null>;
  readonly direction: Signal<SortDirection>;
  /** Every column this sorter can order by, for a sort menu. */
  readonly columns: readonly ServerSortColumn[];

  isSortable(key: string): boolean;
  /** Ascending, descending or none — the value `aria-sort` takes. */
  ariaSort(key: string): 'ascending' | 'descending' | 'none';
  /** First click sorts, a second reverses, a third clears. */
  toggle(key: string): void;
  set(key: string | null, direction?: SortDirection): void;
}

/** A sorter that also holds the ordered rows. */
export interface ClientSorter<T> extends Sorter {
  readonly rows: Signal<readonly T[]>;
}

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function compareValues(kind: SortValueKind, left: unknown, right: unknown): number {
  switch (kind) {
    case 'number':
      return Number(left) - Number(right);
    case 'date':
      return Date.parse(String(left)) - Date.parse(String(right));
    case 'boolean':
      // False first ascending, which reads as "not done" before "done".
      return Number(Boolean(left)) - Number(Boolean(right));
    default:
      /*
       * Numeric collation, so `ctc_2` precedes `ctc_10` and "Batch 9"
       * precedes "Batch 10". Public ids in this app are a prefix and a number,
       * which plain string ordering gets wrong in exactly the way that looks
       * like a bug.
       */
      return COLLATOR.compare(String(left), String(right));
  }
}

/**
 * Compares two rows by one column, with empties last in both directions.
 *
 * A record that has never been modified has no modified date; pushing those
 * rows to the end either way is what makes "sort by Modified" useful, rather
 * than filling the first page with blanks.
 */
export function rowComparator<T>(
  column: SortColumn<T>,
  direction: SortDirection,
): (left: T, right: T) => number {
  const sign = direction === 'asc' ? 1 : -1;

  return (left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    const aEmpty = isEmpty(a);
    const bEmpty = isEmpty(b);

    if (aEmpty || bEmpty) {
      return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    }
    return sign * compareValues(column.kind, a, b);
  };
}

interface SortState {
  readonly key: string | null;
  readonly direction: SortDirection;
}

function createState(columns: readonly { key: string; initialDirection?: SortDirection }[], initial?: SortState) {
  const state = signal<SortState>(initial ?? { key: null, direction: 'asc' });
  const byKey = new Map(columns.map((column) => [column.key, column]));

  return {
    state,
    isSortable: (key: string) => byKey.has(key),
    toggle: (key: string) => {
      const column = byKey.get(key);
      if (column === undefined) {
        return;
      }
      state.update((current) => {
        if (current.key !== key) {
          return { key, direction: column.initialDirection ?? 'asc' };
        }
        // Third click returns the list to its natural order rather than
        // leaving no way back to it.
        const first = column.initialDirection ?? 'asc';
        return current.direction === first
          ? { key, direction: first === 'asc' ? 'desc' : 'asc' }
          : { key: null, direction: 'asc' };
      });
    },
  };
}

/**
 * Client-side ordering for a list the browser already holds in full.
 *
 * Correct only when the whole collection is in hand: sorting a single page of
 * a server-paged list reorders that page and nothing else, which looks like
 * sorting while quietly lying about the other pages. For those lists use
 * {@link serverSorter} against an endpoint that supports it.
 */
export function clientSorter<T>(
  source: Signal<readonly T[]>,
  columns: readonly SortColumn<T>[],
  initial?: SortState,
): ClientSorter<T> {
  const { state, isSortable, toggle } = createState(columns, initial);
  const byKey = new Map(columns.map((column) => [column.key, column]));

  const rows = computed(() => {
    const { key, direction } = state();
    const column = key === null ? undefined : byKey.get(key);
    if (column === undefined) {
      return source();
    }
    // Copied before sorting: the source signal's array is shared.
    return [...source()].sort(rowComparator(column, direction));
  });

  return {
    key: computed(() => state().key),
    direction: computed(() => state().direction),
    columns: columns.map(({ key, label, initialDirection }) => ({ key, label, initialDirection })),
    rows,
    isSortable,
    ariaSort: (key) => ariaSortOf(state(), key),
    toggle,
    set: (key, direction = 'asc') => state.set({ key, direction }),
  };
}

/**
 * The query parameters an API sort takes, or nothing at all when the list is
 * in its natural order.
 *
 * **The direction is spelled out in full.** The API accepts `asc` and `desc`
 * too, but a direction it cannot parse is now a 400 rather than a silent
 * fallback to ascending — and the long form is the one every endpoint has
 * always understood, so there is nothing to gain from the short one.
 *
 * Omitted rather than sent empty: `HttpParams.set` keeps an empty string, and
 * `sortBy=` is a key the allow-list does not contain.
 */
export function sortParams(
  sortBy: string | null | undefined,
  direction: SortDirection = 'asc',
): Record<string, string> {
  return sortBy
    ? { sortBy, sortDirection: direction === 'desc' ? 'descending' : 'ascending' }
    : {};
}

export interface ServerSorterConfig {
  readonly columns: readonly ServerSortColumn[];
  /** Refetch with the new sort. The host reads `key()` and `direction()`. */
  readonly load: () => void;
  readonly initial?: SortState;
}

/**
 * Server-side ordering: holds the chosen column and refetches.
 *
 * The keys must be the ones the endpoint's allow-list accepts — this app's API
 * answers a 400 naming the allowed values for anything else, so a typo is
 * loud rather than silently unsorted.
 */
export function serverSorter(config: ServerSorterConfig): Sorter {
  const { state, isSortable, toggle } = createState(config.columns, config.initial);

  return {
    key: computed(() => state().key),
    direction: computed(() => state().direction),
    columns: config.columns,
    isSortable,
    ariaSort: (key) => ariaSortOf(state(), key),
    toggle: (key) => {
      const before = state();
      toggle(key);
      if (state() !== before) {
        config.load();
      }
    },
    set: (key, direction = 'asc') => {
      state.set({ key, direction });
      config.load();
    },
  };
}

function ariaSortOf(state: SortState, key: string): 'ascending' | 'descending' | 'none' {
  if (state.key !== key) {
    return 'none';
  }
  return state.direction === 'asc' ? 'ascending' : 'descending';
}
