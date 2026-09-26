import { Injectable, inject } from '@angular/core';
import { map, tap, type Observable } from 'rxjs';

import type { BulkOperationResult, PagedResult } from '@core/models/api.model';
import type {
  BulkGroupRequest,
  BulkTagRequest,
  Contact,
  ContactGroup,
  ContactGroupDraft,
  ContactQuery,
  ContactTag,
  ContactTagDraft,
  CreateContactRequest,
  DuplicateGroup,
  DuplicateStrategy,
  ImportCommitRequest,
  ImportPreview,
  ImportResult,
  MembershipRequest,
  MergeContactsRequest,
  UpdateContactRequest,
} from '@core/models/contact.model';
import { toAdaptivePage, type AdaptivePage, type ListQuery } from '@core/http/adaptive-page';
import { rowComparator, sortParams, type SortColumn } from '@shared/ui/data-table/sort';
import { ApiService } from './api.service';

/**
 * What a group list can be ordered by.
 *
 * Here rather than in the component because the fallback path sorts the whole
 * collection **before** slicing it — a screen that sorted its own page would
 * order ten rows out of four hundred.
 */
export const GROUP_SORT_COLUMNS: readonly SortColumn<ContactGroup>[] = [
  { key: 'id', label: 'ID', kind: 'text', value: (group) => group.id },
  { key: 'name', label: 'Name', kind: 'text', value: (group) => group.name },
  {
    key: 'contactCount',
    label: 'Contacts',
    kind: 'number',
    value: (group) => group.contactCount,
    initialDirection: 'desc',
  },
  {
    key: 'createdAt',
    label: 'Created',
    kind: 'date',
    value: (group) => group.createdAt,
    initialDirection: 'desc',
  },
  {
    key: 'updatedAt',
    label: 'Modified',
    kind: 'date',
    value: (group) => group.updatedAt,
    initialDirection: 'desc',
  },
];

/** What a tag list can be ordered by. `ContactTag` has `createdAt` and no modified pair. */
export const TAG_SORT_COLUMNS: readonly SortColumn<ContactTag>[] = [
  { key: 'id', label: 'ID', kind: 'text', value: (tag) => tag.id },
  { key: 'name', label: 'Name', kind: 'text', value: (tag) => tag.name },
  { key: 'color', label: 'Colour', kind: 'text', value: (tag) => tag.color },
  {
    key: 'contactCount',
    label: 'Contacts',
    kind: 'number',
    value: (tag) => tag.contactCount,
    initialDirection: 'desc',
  },
  {
    key: 'createdAt',
    label: 'Created',
    kind: 'date',
    value: (tag) => tag.createdAt,
    initialDirection: 'desc',
  },
];

/** The comparator a query names, or null for the collection's natural order. */
export function comparatorFor<T>(
  columns: readonly SortColumn<T>[],
  query: ListQuery,
): ((left: T, right: T) => number) | null {
  const column = columns.find((entry) => entry.key === query.sortBy);
  return column === undefined ? null : rowComparator(column, query.sortDirection ?? 'asc');
}

@Injectable({ providedIn: 'root' })
export class ContactsService {
  private readonly api = inject(ApiService);

  /* ------------------------------ reads ------------------------------ */

  list(query: ContactQuery): Observable<PagedResult<Contact>> {
    const params: Record<string, string | number> = {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      // The API expects the literal "all" to clear a filter.
      status: query.status,
      groupId: query.groupId,
      tagId: query.tagId,
    };

    return this.api.get<PagedResult<Contact>>('/contacts', {
      ...params,
      ...sortParams(query.sortBy, query.sortDirection),
    });
  }

  getById(id: string): Observable<Contact> {
    return this.api.get<Contact>(`/contacts/${id}`);
  }

  listDuplicates(
    strategy: DuplicateStrategy,
    page: number,
    pageSize: number,
  ): Observable<PagedResult<DuplicateGroup>> {
    return this.api.get<PagedResult<DuplicateGroup>>('/contacts/duplicates', {
      strategy,
      page,
      pageSize,
    });
  }

  /**
   * Every group, for the pickers.
   *
   * The filter dropdown, the contact editor and the bulk bar each need the
   * whole set — a page of ten would silently hide the rest — so this stays
   * unpaged deliberately. The **list screen** uses {@link pageGroups}.
   */
  listGroups(): Observable<readonly ContactGroup[]> {
    return this.api.get<readonly ContactGroup[]>('/groups');
  }

  /** Every tag, for the pickers. The list screen uses {@link pageTags}. */
  listTags(): Observable<readonly ContactTag[]> {
    return this.api.get<readonly ContactTag[]>('/tags');
  }

  /**
   * One page of groups, searched and ordered by the API.
   *
   * Sends the paging parameters and adapts whatever comes back: an endpoint
   * that pages answers a `PagedResult` and this passes it through; one that
   * still answers the whole collection is filtered, ordered and sliced here.
   * The screen cannot tell the difference, so the day `/groups` starts paging
   * there is nothing to change — see `docs/API-LIST-PAGINATION-BACKEND.md`.
   */
  pageGroups(query: ListQuery): Observable<AdaptivePage<ContactGroup>> {
    return this.api
      .get<PagedResult<ContactGroup> | readonly ContactGroup[]>('/groups', {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search ?? '',
        ...sortParams(query.sortBy, query.sortDirection),
      })
      .pipe(
        map((response) =>
          toAdaptivePage(response, query, {
            matches: (group, term) =>
              group.name.toLowerCase().includes(term) ||
              group.description.toLowerCase().includes(term),
            compare: (current) => comparatorFor(GROUP_SORT_COLUMNS, current),
          }),
        ),
      );
  }

  /** One page of tags. Same adaptation as {@link pageGroups}. */
  pageTags(query: ListQuery): Observable<AdaptivePage<ContactTag>> {
    return this.api
      .get<PagedResult<ContactTag> | readonly ContactTag[]>('/tags', {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search ?? '',
        ...sortParams(query.sortBy, query.sortDirection),
      })
      .pipe(
        map((response) =>
          toAdaptivePage(response, query, {
            matches: (tag, term) => tag.name.toLowerCase().includes(term),
            compare: (current) => comparatorFor(TAG_SORT_COLUMNS, current),
          }),
        ),
      );
  }

  /* ------------------------------ contact writes ------------------------------ */

  create(request: CreateContactRequest): Observable<Contact> {
    return this.api.post<Contact, CreateContactRequest>('/contacts', request);
  }

  update(id: string, request: UpdateContactRequest): Observable<Contact> {
    return this.api.put<Contact, UpdateContactRequest>(`/contacts/${id}`, request);
  }

  remove(id: string): Observable<null> {
    return this.api.delete(`/contacts/${id}`);
  }

  bulkDelete(ids: readonly string[]): Observable<BulkOperationResult> {
    return this.api.post<BulkOperationResult>('/contacts/bulk-delete', { ids });
  }

  bulkTag(request: BulkTagRequest): Observable<BulkOperationResult> {
    return this.api.post<BulkOperationResult, BulkTagRequest>('/contacts/bulk-tag', request);
  }

  bulkGroup(request: BulkGroupRequest): Observable<BulkOperationResult> {
    return this.api.post<BulkOperationResult, BulkGroupRequest>('/contacts/bulk-group', request);
  }

  merge(request: MergeContactsRequest): Observable<Contact> {
    return this.api.post<Contact, MergeContactsRequest>('/contacts/merge', request);
  }

  /* ------------------------------ import / export ------------------------------ */

  importPreview(file: File): Observable<ImportPreview> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.api.upload<ImportPreview>('/contacts/import/preview', form);
  }

  /** Runs synchronously and returns the finished result — do not poll after this. */
  importCommit(request: ImportCommitRequest): Observable<ImportResult> {
    return this.api.post<ImportResult, ImportCommitRequest>('/contacts/import/commit', request);
  }

  getImportJob(jobId: string): Observable<ImportResult> {
    return this.api.get<ImportResult>(`/contacts/import/${jobId}`);
  }

  /** Streams CSV; saved client-side because the token cannot ride a plain link. */
  /**
   * Contacts as CSV — the ticked rows, or everything matching the filters.
   *
   * `/contacts/export` takes `ContactExportQuery`, which is the list's own query
   * plus `Ids`. When ids are present the API ignores the filters entirely: a
   * selection already answers "which rows", and intersecting it with a filter
   * would silently drop rows the operator ticked.
   *
   * Ids go as repeated keys — see `QueryParams`. This once sent them joined,
   * which the API read as one unparseable id and answered with an empty file.
   */
  exportCsv(query: Partial<ContactQuery> & { ids?: readonly string[] }): Observable<Blob> {
    const ids = query.ids ?? [];
    return this.api
      .download('/contacts/export', {
        search: query.search ?? '',
        status: query.status ?? 'all',
        groupId: query.groupId ?? 'all',
        tagId: query.tagId ?? 'all',
        ...(ids.length > 0 ? { ids } : {}),
      })
      .pipe(tap((blob) => saveBlob(blob, 'contacts.csv')));
  }

  /* ------------------------------ groups ------------------------------ */

  createGroup(draft: ContactGroupDraft): Observable<ContactGroup> {
    return this.api.post<ContactGroup, ContactGroupDraft>('/groups', draft);
  }

  updateGroup(id: string, draft: Partial<ContactGroupDraft>): Observable<ContactGroup> {
    return this.api.put<ContactGroup, Partial<ContactGroupDraft>>(`/groups/${id}`, draft);
  }

  deleteGroup(id: string): Observable<null> {
    return this.api.delete(`/groups/${id}`);
  }

  listGroupMembers(id: string, page: number, pageSize: number): Observable<PagedResult<Contact>> {
    return this.api.get<PagedResult<Contact>>(`/groups/${id}/contacts`, { page, pageSize });
  }

  addToGroup(id: string, contactIds: readonly string[]): Observable<BulkOperationResult> {
    return this.api.post<BulkOperationResult, MembershipRequest>(`/groups/${id}/contacts`, {
      contactIds,
    });
  }

  removeFromGroup(id: string, contactIds: readonly string[]): Observable<BulkOperationResult> {
    return this.api.delete<BulkOperationResult>(`/groups/${id}/contacts`, { contactIds });
  }

  /* ------------------------------ tags ------------------------------ */

  createTag(draft: ContactTagDraft): Observable<ContactTag> {
    return this.api.post<ContactTag, ContactTagDraft>('/tags', draft);
  }

  updateTag(id: string, draft: Partial<ContactTagDraft>): Observable<ContactTag> {
    return this.api.put<ContactTag, Partial<ContactTagDraft>>(`/tags/${id}`, draft);
  }

  deleteTag(id: string): Observable<null> {
    return this.api.delete(`/tags/${id}`);
  }

  listTaggedContacts(id: string, page: number, pageSize: number): Observable<PagedResult<Contact>> {
    return this.api.get<PagedResult<Contact>>(`/tags/${id}/contacts`, { page, pageSize });
  }

  applyTag(id: string, contactIds: readonly string[]): Observable<BulkOperationResult> {
    return this.api.post<BulkOperationResult, MembershipRequest>(`/tags/${id}/contacts`, {
      contactIds,
    });
  }

  removeTag(id: string, contactIds: readonly string[]): Observable<BulkOperationResult> {
    return this.api.delete<BulkOperationResult>(`/tags/${id}/contacts`, { contactIds });
  }
}

/** Triggers a browser download for an in-memory blob. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
