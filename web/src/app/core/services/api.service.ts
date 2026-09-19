import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { environment } from '@env/environment';
import type { ApiResponse } from '@core/models/api.model';

/**
 * Query string values.
 *
 * Arrays are sent as **repeated keys** — `ids=a&ids=b` — because that is what
 * ASP.NET binds to a list by default. Joining them first (`ids=a,b`) binds as a
 * single element that parses as no id at all, which is how the contacts
 * selection export silently produced a header-only file.
 */
export type QueryParams = Readonly<
  Record<string, string | number | boolean | readonly string[]>
>;

/**
 * The payload of an envelope, or `null` for an empty body.
 *
 * A `204 No Content` arrives with no body at all — the heartbeat and revoke
 * endpoints answer that way — and reading `.data` off it threw, turning a
 * successful call into an error for its caller.
 */
function unwrap<T>(response: ApiResponse<T> | null): T {
  return (response === null ? null : response.data) as T;
}

export function toHttpParams(params: QueryParams | undefined): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) {
      // An empty list is omitted rather than sent as nothing: `ids=` would bind
      // as one empty element, which is a selection of no rows, not "no filter".
      for (const item of value as readonly string[]) {
        httpParams = httpParams.append(key, item);
      }
      continue;
    }
    httpParams = httpParams.set(key, String(value));
  }
  return httpParams;
}

/**
 * Typed wrapper over HttpClient that prefixes the versioned base URL and
 * unwraps the `ApiResponse<T>` envelope, so feature services deal in domain
 * types only. Failures are RFC 7807 documents and are normalised separately by
 * `errorInterceptor`.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.http
      .get<ApiResponse<T>>(`${this.baseUrl}${path}`, { params: toHttpParams(params) })
      .pipe(map((response) => unwrap(response)));
  }

  /**
   * `headers` covers the few calls that carry an `Idempotency-Key` — actions
   * that send real messages or move money, where a retry must not repeat the
   * effect.
   */
  post<TResponse, TBody = unknown>(
    path: string,
    body?: TBody,
    params?: QueryParams,
    headers?: Readonly<Record<string, string>>,
  ): Observable<TResponse> {
    return this.http
      .post<ApiResponse<TResponse>>(`${this.baseUrl}${path}`, body ?? {}, {
        params: toHttpParams(params),
        headers,
      })
      .pipe(map((response) => unwrap(response)));
  }

  put<TResponse, TBody = unknown>(path: string, body?: TBody): Observable<TResponse> {
    return this.http
      .put<ApiResponse<TResponse>>(`${this.baseUrl}${path}`, body ?? {})
      .pipe(map((response) => unwrap(response)));
  }

  /** Partial update: only the fields sent change. */
  patch<TResponse, TBody = unknown>(path: string, body: TBody): Observable<TResponse> {
    return this.http
      .patch<ApiResponse<TResponse>>(`${this.baseUrl}${path}`, body)
      .pipe(map((response) => unwrap(response)));
  }

  delete<TResponse = null>(path: string, body?: unknown): Observable<TResponse> {
    return this.http
      .delete<ApiResponse<TResponse>>(`${this.baseUrl}${path}`, { body })
      .pipe(map((response) => unwrap(response)));
  }

  /** Multipart upload; the envelope is unwrapped as usual. */
  upload<T>(path: string, form: FormData): Observable<T> {
    return this.http
      .post<ApiResponse<T>>(`${this.baseUrl}${path}`, form)
      .pipe(map((response) => unwrap(response)));
  }

  /**
   * Authenticated file download. A bearer token cannot ride a plain `<a href>`,
   * so the response is fetched as a blob and saved client-side.
   */
  download(path: string, params?: QueryParams): Observable<Blob> {
    return this.http.get(`${this.baseUrl}${path}`, {
      params: toHttpParams(params),
      responseType: 'blob',
    });
  }

  /**
   * Downloads a URL the API handed back rather than one we composed.
   *
   * Payloads carry links in whichever form the server prefers — absolute, or
   * rooted at `/api/v1` — so both are accepted and only a bare resource path
   * gets the base URL prepended. Anything already carrying it would otherwise
   * end up doubled.
   */
  downloadAbsolute(url: string): Observable<Blob> {
    const resolved = /^https?:\/\//i.test(url)
      ? url
      : url.startsWith(this.baseUrl) || url.startsWith('/api/')
        ? url
        : `${this.baseUrl}${url}`;

    return this.http.get(resolved, { responseType: 'blob' });
  }
}
