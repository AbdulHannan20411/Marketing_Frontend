import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import type { ApiError, BulkOperationResult, LoadState } from '@core/models/api.model';
import { AuthService } from '@core/auth/auth.service';
import type {
  BulkMode,
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
import { DEFAULT_PAGE_SIZE } from '@shared/ui/pagination/pagination.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { ContactEditorComponent } from './contact-editor.component';

const STATUS_TONE: Readonly<Record<ContactStatus, BadgeTone>> = {
  subscribed: 'success',
  unsubscribed: 'neutral',
  blocked: 'danger',
};



@Component({
  selector: 'app-contacts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
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
  /**
   * Selected rows, keyed by id and holding the whole contact.
   *
   * The contact is kept — not just the id — because selection survives paging,
   * and the tag and group pickers need to know what each selected contact
   * already carries even after the user has moved to another page.
   */
  protected readonly selected = signal<ReadonlyMap<string, Contact>>(new Map());
  protected readonly busy = signal(false);

  /** Whether the tag and group pickers apply or strip the chosen value. */
  protected readonly bulkMode = signal<BulkMode>('add');

  protected readonly tagPickerLabel = computed(() =>
    this.bulkMode() === 'add' ? 'Add tag…' : 'Remove tag…',
  );

  protected readonly groupPickerLabel = computed(() =>
    this.bulkMode() === 'add' ? 'Add to group…' : 'Remove from group…',
  );

  protected readonly creating = signal(false);
  protected readonly saving = signal(false);
  protected readonly createFieldErrors = signal<Readonly<Record<string, readonly string[]>>>({});

  /** The API rejects a create the user lacks the permission for; hide the button too. */
  protected readonly canCreate = computed(() => this.auth.hasPermission('contacts.create'));

  protected readonly pageSize = signal(DEFAULT_PAGE_SIZE);
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

  protected readonly selectedCount = computed(() => this.selected().size);
  private readonly selectedList = computed(() => [...this.selected().values()]);

  protected readonly allOnPageSelected = computed(() => {
    const rows = this.contacts();
    const selected = this.selected();
    return rows.length > 0 && rows.every((contact) => selected.has(contact.id));
  });

  /**
   * Only offer what the action can actually change: tags at least one selected
   * contact already has when removing, and tags at least one still lacks when
   * adding. Offering the rest invites clicks that quietly do nothing.
   */
  protected readonly tagOptions = computed(() => {
    const rows = this.selectedList();
    const all = this.tags();
    if (rows.length === 0) {
      return all;
    }
    return this.bulkMode() === 'remove'
      ? all.filter((tag) => rows.some((contact) => contact.tagIds.includes(tag.id)))
      : all.filter((tag) => rows.some((contact) => !contact.tagIds.includes(tag.id)));
  });

  protected readonly groupOptions = computed(() => {
    const rows = this.selectedList();
    const all = this.groups();
    if (rows.length === 0) {
      return all;
    }
    return this.bulkMode() === 'remove'
      ? all.filter((group) => rows.some((contact) => contact.groupIds.includes(group.id)))
      : all.filter((group) => rows.some((contact) => !contact.groupIds.includes(group.id)));
  });

  protected readonly tagPickerEmpty = computed(() => this.tagOptions().length === 0);
  protected readonly groupPickerEmpty = computed(() => this.groupOptions().length === 0);

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
        pageSize: this.pageSize(),
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

  /** A different page size makes the old page number meaningless. */
  protected onPageSizeChange(size: number): void {
    this.pageSize.set(size);
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

  protected toggleRow(contact: Contact): void {
    this.selected.update((current) => {
      const next = new Map(current);
      if (next.has(contact.id)) {
        next.delete(contact.id);
      } else {
        next.set(contact.id, contact);
      }
      return next;
    });
  }

  protected toggleAllOnPage(): void {
    const shouldClear = this.allOnPageSelected();
    this.selected.update((current) => {
      const next = new Map(current);
      for (const contact of this.contacts()) {
        if (shouldClear) {
          next.delete(contact.id);
        } else {
          next.set(contact.id, contact);
        }
      }
      return next;
    });
  }

  protected clearSelection(): void {
    this.selected.set(new Map());
  }

  protected isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  protected tagFor(tagId: string): ContactTag | undefined {
    return this.tagNameById().get(tagId);
  }

  /** Applies a bulk result: report it, drop the selection, refresh the page. */
  private applyBulkResult(result: BulkOperationResult, outcome: string): void {
    this.busy.set(false);
    this.clearSelection();

    if (result.failed.length > 0) {
      this.toast.warning(
        `${outcome} for some contacts`,
        `${result.succeeded} of ${result.requested} succeeded. ${result.failed[0]?.reason ?? ''}`,
      );
    } else {
      this.toast.success(outcome, `${result.succeeded} contacts updated.`);
    }

    this.load();
  }

  private failBulk(action: string): void {
    this.busy.set(false);
    this.toast.error(`Could not ${action}`, 'The request failed. Please try again.');
  }

  protected bulkDelete(): void {
    const ids = [...this.selected().keys()];
    if (ids.length === 0 || this.busy()) {
      return;
    }
    this.busy.set(true);

    this.contactsService.bulkDelete(ids).subscribe({
      next: (result) => this.applyBulkResult(result, 'Contacts deleted'),
      error: () => this.failBulk('delete those contacts'),
    });
  }

  /**
   * Applies or strips a tag across the selection. Removing a tag a contact does
   * not carry is a no-op server-side, so the whole selection can be sent.
   */
  protected bulkApplyTag(tagId: string): void {
    const ids = [...this.selected().keys()];
    if (tagId === '' || ids.length === 0 || this.busy()) {
      return;
    }
    this.busy.set(true);
    const mode = this.bulkMode();

    this.contactsService.bulkTag({ ids, tagIds: [tagId], mode }).subscribe({
      next: (result) =>
        this.applyBulkResult(result, mode === 'add' ? 'Tag added' : 'Tag removed'),
      error: () => this.failBulk(mode === 'add' ? 'add the tag' : 'remove the tag'),
    });
  }

  protected bulkApplyGroup(groupId: string): void {
    const ids = [...this.selected().keys()];
    if (groupId === '' || ids.length === 0 || this.busy()) {
      return;
    }
    this.busy.set(true);
    const mode = this.bulkMode();

    this.contactsService.bulkGroup({ ids, groupIds: [groupId], mode }).subscribe({
      next: (result) =>
        this.applyBulkResult(
          result,
          mode === 'add' ? 'Added to group' : 'Removed from group',
        ),
      error: () => this.failBulk(mode === 'add' ? 'assign the group' : 'remove from the group'),
    });
  }

  /** Exports the current filter, or just the selection when rows are ticked. */
  protected exportCsv(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    const selected = [...this.selected().keys()];

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
