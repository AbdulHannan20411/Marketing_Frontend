import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import type { Contact, ContactGroup, ContactQuery, ContactTag } from '@core/models/contact.model';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class ContactsService {
  private readonly api = inject(ApiService);

  list(query: ContactQuery): Observable<PagedResult<Contact>> {
    return this.api.get<PagedResult<Contact>>('/contacts', {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status,
      groupId: query.groupId,
    });
  }

  listGroups(): Observable<readonly ContactGroup[]> {
    return this.api.get<readonly ContactGroup[]>('/groups');
  }

  listTags(): Observable<readonly ContactTag[]> {
    return this.api.get<readonly ContactTag[]>('/tags');
  }
}
