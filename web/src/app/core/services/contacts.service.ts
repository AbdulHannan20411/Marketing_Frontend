import { Injectable, inject } from '@angular/core';
import { tap, type Observable } from 'rxjs';

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
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class ContactsService {
  private readonly api = inject(ApiService);

  /* ------------------------------ reads ------------------------------ */

  list(query: ContactQuery): Observable<PagedResult<Contact>> {
    return this.api.get<PagedResult<Contact>>('/contacts', {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      // The API expects the literal "all" to clear a filter.
      status: query.status,
      groupId: query.groupId,
      tagId: query.tagId,
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

  listGroups(): Observable<readonly ContactGroup[]> {
    return this.api.get<readonly ContactGroup[]>('/groups');
  }

  listTags(): Observable<readonly ContactTag[]> {
    return this.api.get<readonly ContactTag[]>('/tags');
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
  exportCsv(query: Partial<ContactQuery> & { ids?: string }): Observable<Blob> {
    return this.api
      .download('/contacts/export', {
        search: query.search ?? '',
        status: query.status ?? 'all',
        groupId: query.groupId ?? 'all',
        tagId: query.tagId ?? 'all',
        ...(query.ids === undefined ? {} : { ids: query.ids }),
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
