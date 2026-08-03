import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { environment } from '@env/environment';
import type { ApiResponse } from '@core/models/api.model';

export type QueryParams = Readonly<Record<string, string | number | boolean>>;

function toHttpParams(params: QueryParams | undefined): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    httpParams = httpParams.set(key, String(value));
  }
  return httpParams;
}

/**
 * Thin typed wrapper over HttpClient that prefixes the versioned base URL and
 * unwraps the `ApiResponse<T>` envelope, so feature services deal in domain types only.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.http
      .get<ApiResponse<T>>(`${this.baseUrl}${path}`, { params: toHttpParams(params) })
      .pipe(map((response) => response.data));
  }

  post<TResponse, TBody = unknown>(path: string, body?: TBody): Observable<TResponse> {
    return this.http
      .post<ApiResponse<TResponse>>(`${this.baseUrl}${path}`, body ?? {})
      .pipe(map((response) => response.data));
  }
}
