import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { SearchResultGroup } from '@core/models/search.model';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly api = inject(ApiService);

  search(query: string): Observable<readonly SearchResultGroup[]> {
    return this.api.get<readonly SearchResultGroup[]>('/search', { q: query });
  }
}
