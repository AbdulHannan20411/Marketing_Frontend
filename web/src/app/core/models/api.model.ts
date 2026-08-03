/** Envelope returned by every `/api/v1/` endpoint. */
export interface ApiResponse<T> {
  readonly data: T;
  readonly message: string | null;
  readonly traceId: string;
}

export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export type SortDirection = 'asc' | 'desc';

export interface PageQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly sortBy?: string;
  readonly sortDirection?: SortDirection;
}

export interface ApiError {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly traceId: string | null;
}

/** Discriminated state for any async view slice — drives skeleton / empty / error UI. */
export type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
