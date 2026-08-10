import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type { ApiError, BulkOperationResult, LoadState } from '@core/models/api.model';
import { AuthService } from '@core/auth/auth.service';
import type {
  Contact,
  ContactGroup,
  ContactStatus,
  ContactTag,
  CreateContactRequest,
} from '@core/models/contact.model';
import { ContactsService } from '@core/services/contacts.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import {
  DataTableComponent,
  type TableColumn,
} from '@shared/ui/data-table/data-table.component';
import { TableRowDirective } from '@shared/ui/data-table/table-row.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { ContactEditorComponent } from './contact-editor.component';

const STATUS_TONE: Readonly<Record<ContactStatus, BadgeTone>> = {
  subscribed: 'success',
  unsubscribed: 'neutral',
  blocked: 'danger',
};

const PAGE_SIZE = 12;

@Component({
  selector: 'app-contacts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    TimeAgoPipe,
    PageHeaderComponent,
    DataTableComponent,
    TableRowDirective,
    AvatarComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    ContactEditorComponent,
  ],
  templateUrl: './contacts.component.html',
})
export class ContactsComponent {
  private readonly contactsService = inject(ContactsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly searchInput = new Subject<string>();

  protected readonly state = signal<LoadState>('loading');
  protected readonly contacts = signal<readonly Contact[]>([]);
  protected readonly groups = signal<readonly ContactGroup[]>([]);
  protected readonly tags = signal<readonly ContactTag[]>([]);
  protected readonly totalItems = signal(0);
  protected readonly page = signal(1);
  protected readonly search = signal('');
  protected readonly status = signal<ContactStatus | 'all'>('all');
  protected readonly groupId = signal<string | 'all'>('all');
  protected readonly tagId = signal<string | 'all'>('all');
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);

  protected readonly creating = signal(false);
  protected readonly saving = signal(false);
  protected readonly createFieldErrors = signal<Readonly<Record<string, readonly string[]>>>({});

  /** The API rejects a create the user lacks the permission for; hide the button too. */
  protected readonly canCreate = computed(() => this.auth.hasPermission('contacts.create'));

  protected readonly pageSize = PAGE_SIZE;
  protected readonly statusTone = STATUS_TONE;

  protected readonly columns: readonly TableColumn[] = [
    { key: 'select', header: '', widthClass: 'w-10' },
    { key: 'name', header: 'Contact' },
    { key: 'phone', header: 'Phone', hideOnMobile: true },
    { key: 'country', header: 'Country', hideOnMobile: true },
    { key: 'tags', header: 'Tags', hideOnMobile: true },
    { key: 'status', header: 'Status' },
    { key: 'lastMessaged', header: 'Last messaged', align: 'right', hideOnMobile: true },
  ];

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly allOnPageSelected = computed(() => {
    const rows = this.contacts();
    const selected = this.selectedIds();
    return rows.length > 0 && rows.every((contact) => selected.has(contact.id));
  });

  protected readonly hasFilters = computed(
    () =>
      this.search() !== '' ||
      this.status() !== 'all' ||
      this.groupId() !== 'all' ||
      this.tagId() !== 'all',
  );

  private readonly tagNameById = computed(() => {
    const lookup = new Map<string, ContactTag>();
    for (const tag of this.tags()) {
      lookup.set(tag.id, tag);
    }
    return lookup;
  });

  constructor() {
    this.searchInput
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        this.page.set(1);
        this.load();
      });

    this.contactsService.listGroups().subscribe({ next: (groups) => this.groups.set(groups) });
    this.contactsService.listTags().subscribe({ next: (tags) => this.tags.set(tags) });
    this.load();
  }

  protected load(): void {
    this.state.set('loading');

    this.contactsService
      .list({
        page: this.page(),
        pageSize: PAGE_SIZE,
        search: this.search(),
        status: this.status(),
        groupId: this.groupId(),
        tagId: this.tagId(),
      })
      .subscribe({
        next: (result) => {
          this.contacts.set(result.items);
          this.totalItems.set(result.totalItems);
          this.state.set(result.totalItems === 0 ? 'empty' : 'ready');
        },
        error: () => this.state.set('error'),
      });
  }

  protected onSearch(event: Event): void {
    this.searchInput.next((event.target as HTMLInputElement).value);
  }

  protected onStatusChange(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as ContactStatus | 'all');
    this.page.set(1);
    this.load();
  }

  protected onGroupChange(event: Event): void {
    this.groupId.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected onTagChange(event: Event): void {
    this.tagId.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
    this.load();
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('all');
    this.groupId.set('all');
    this.tagId.set('all');
    this.page.set(1);
    this.load();
  }

  protected toggleRow(id: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  protected toggleAllOnPage(): void {
    const shouldClear = this.allOnPageSelected();
    this.selectedIds.update((current) => {
      const next = new Set(current);
      for (const contact of this.contacts()) {
        if (shouldClear) {
          next.delete(contact.id);
        } else {
          next.add(contact.id);
        }
      }
      return next;
    });
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected tagFor(tagId: string): ContactTag | undefined {
    return this.tagNameById().get(tagId);
  }

  /** Applies a bulk result: report it, drop the selection, refresh the page. */
  private applyBulkResult(result: BulkOperationResult, verb: string): void {
    this.busy.set(false);
    this.clearSelection();

    if (result.failed.length > 0) {
      this.toast.warning(
        `${verb} partially applied`,
        `${result.succeeded} of ${result.requested} succeeded. ${result.failed[0]?.reason ?? ''}`,
      );
    } else {
      this.toast.success(`${verb} applied`, `${result.succeeded} contacts updated.`);
    }

    this.load();
  }

  private failBulk(verb: string): void {
    this.busy.set(false);
    this.toast.error(`Could not ${verb.toLowerCase()}`, 'The request failed. Please try again.');
  }

  protected bulkDelete(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0 || this.busy()) {
      return;
    }
    this.busy.set(true);

    this.contactsService.bulkDelete(ids).subscribe({
      next: (result) => this.applyBulkResult(result, 'Delete'),
      error: () => this.failBulk('Delete'),
    });
  }

  protected bulkAddTag(tagId: string): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0 || this.busy()) {
      return;
    }
    this.busy.set(true);

    this.contactsService.bulkTag({ ids, tagIds: [tagId], mode: 'add' }).subscribe({
      next: (result) => this.applyBulkResult(result, 'Tag'),
      error: () => this.failBulk('Tag'),
    });
  }

  protected bulkAssignGroup(groupId: string): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0 || this.busy()) {
      return;
    }
    this.busy.set(true);

    this.contactsService.bulkGroup({ ids, groupIds: [groupId], mode: 'add' }).subscribe({
      next: (result) => this.applyBulkResult(result, 'Group'),
      error: () => this.failBulk('Group'),
    });
  }

  /** Exports the current filter, or just the selection when rows are ticked. */
  protected exportCsv(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    const selected = [...this.selectedIds()];

    this.contactsService
      .exportCsv({
        search: this.search(),
        status: this.status(),
        groupId: this.groupId(),
        tagId: this.tagId(),
        ...(selected.length > 0 ? { ids: selected.join(',') } : {}),
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success('Export ready', 'Your CSV has been downloaded.');
        },
        error: () => this.failBulk('Export'),
      });
  }

  protected announcePending(action: string): void {
    this.toast.info(`${action}`, 'This flow lands with the next milestone.');
  }

  /* ------------------------------ create ------------------------------ */

  protected openCreate(): void {
    this.createFieldErrors.set({});
    this.creating.set(true);
  }

  protected closeCreate(): void {
    this.creating.set(false);
    this.createFieldErrors.set({});
  }

  protected createContact(request: CreateContactRequest): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.createFieldErrors.set({});

    this.contactsService.create(request).subscribe({
      next: (contact) => {
        this.saving.set(false);
        this.creating.set(false);
        this.toast.success('Contact added', `${contact.fullName} is now in your audience.`);
        // Show the newcomer rather than leaving the user on a stale page.
        this.page.set(1);
        this.load();
      },
      error: (error: ApiError) => {
        this.saving.set(false);

        // 422 binds to the fields; a duplicate number or plan limit is a 409
        // carrying a sentence worth showing as-is.
        if (Object.keys(error.fieldErrors).length > 0) {
          this.createFieldErrors.set(error.fieldErrors);
          return;
        }
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
