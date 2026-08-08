/** Envelope returned by every successful `/api/v1/` response. */
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

/** Wire values are lowercase — the API rejects `Ascending`. */
export type SortDirection = 'ascending' | 'descending';

export interface PageQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly sortBy?: string;
  readonly sortDirection?: SortDirection;
}

/**
 * RFC 7807 problem document, normalised by the error interceptor.
 *
 * Failures are **not** wrapped in `ApiResponse`. `errorCode` is the stable
 * discriminator — branch on it rather than on the HTTP status, because the API
 * returns 409 for business rules where 422 might be expected.
 */
export interface ApiError {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  /** e.g. `contact_limit_reached`, `downgrade_blocked`, `validation_failed`. */
  readonly errorCode: string;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly traceId: string | null;
  /** Support reference; present on unhandled failures. */
  readonly exceptionId: string | null;
}

/** Discriminated state for any async view slice — drives skeleton / empty / error UI. */
export type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/** Result of a bulk operation. Partial failure is normal, so this is a 200. */
export interface BulkItemFailure {
  readonly id: string;
  readonly reason: string;
}

export interface BulkOperationResult {
  readonly requested: number;
  readonly succeeded: number;
  readonly failed: readonly BulkItemFailure[];
}
