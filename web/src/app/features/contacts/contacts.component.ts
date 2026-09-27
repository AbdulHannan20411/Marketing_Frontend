import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import type {
  ApiError,
  BulkOperationResult,
  LoadState,
} from '@core/models/api.model';
import { AuthService } from '@core/auth/auth.service';
import type {
  Contact,
  ContactGroup,
  ContactStatus,
  ContactTag,
  CreateContactRequest,
  UpdateContactRequest,
} from '@core/models/contact.model';
import {
  NATIONAL_FORMAT_WARNING,
  isStoredNonInternational,
} from '@core/models/phone.model';
import { latestRequest } from '@core/http/latest-request';
import { ContactsService } from '@core/services/contacts.service';
import { ExportNotificationService } from '@core/services/export-notification.service';
import { ExportsService } from '@core/services/exports.service';
import { PlanGateService } from '@core/services/plan-gate.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import {
  BadgeComponent,
  type BadgeTone,
} from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import {
  DataTableComponent,
  type TableColumn,
} from '@shared/ui/data-table/data-table.component';
import { TableRowDirective } from '@shared/ui/data-table/table-row.directive';
import { HistoryButtonComponent } from '@shared/audit/history-button.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { MenuItemDirective } from '@shared/ui/menu/menu-item.directive';
import { RowActionsComponent } from '@shared/ui/menu/row-actions.component';
import { serverPager } from '@shared/ui/pagination/pager';
import { serverSorter } from '@shared/ui/data-table/sort';
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
    HistoryButtonComponent,
    RowActionsComponent,
    MenuItemDirective,
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
  private readonly exports = inject(ExportsService);
  private readonly exportNotifications = inject(ExportNotificationService);
  private readonly toast = inject(ToastService);
  private readonly gate = inject(PlanGateService);
  private readonly auth = inject(AuthService);
  private readonly searchInput = new Subject<string>();

  protected readonly state = signal<LoadState>('loading');
  protected readonly contacts = signal<readonly Contact[]>([]);

  protected readonly nationalWarning = NATIONAL_FORMAT_WARNING;

  /**
   * A stored number that is not in international form.
   *
   * These predate the API converting on save and will never reach a handset.
   * Badging them turns an invisible problem into a list somebody can work
   * through; nothing rewrites them automatically.
   */
  protected isNonInternational(contact: Contact): boolean {
    return isStoredNonInternational(contact.phoneNumber);
  }
  protected readonly groups = signal<readonly ContactGroup[]>([]);
  protected readonly tags = signal<readonly ContactTag[]>([]);
  protected readonly totalItems = signal(0);
  protected readonly search = signal('');
  protected readonly status = signal<ContactStatus | 'all'>('all');
  protected readonly groupId = signal<string | 'all'>('all');
  protected readonly tagId = signal<string | 'all'>('all');

  protected readonly creating = signal(false);
  protected readonly editing = signal(false);

  protected readonly editingContact = signal<Contact | null>(null);

  protected readonly saving = signal(false);

  protected readonly createFieldErrors = signal<
    Readonly<Record<string, readonly string[]>>
  >({});

  protected readonly editFieldErrors = signal<
    Readonly<Record<string, readonly string[]>>
  >({});

  protected readonly busy = signal(false);

  /** The API rejects a create the user lacks the permission for; hide the button too. */
  protected readonly canEdit = computed(() => this.auth.hasPermission('contacts.edit'));
  protected readonly canDelete = computed(() => this.auth.hasPermission('contacts.delete'));

  protected readonly canCreate = computed(() =>
    this.auth.hasPermission('contacts.create'),
  );

  /** The API pages contacts; `load()` reads the page and size from here. */
  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
  });
  protected readonly statusTone = STATUS_TONE;

  protected readonly columns: readonly TableColumn[] = [
    // The actions menu, first and headerless. It used to be a checkbox column
    // here and a History button at the far end; both are now this.
    { key: 'actions', header: '', widthClass: 'w-12' },
    // `sortKey` only where the API's allow-list accepts it: this list is paged
    // by the server, so ordering one page in the browser would reorder the
    // page and nothing else.
    { key: 'id', header: 'ID', widthClass: 'w-28', sortKey: 'id' },
    { key: 'name', header: 'Contact', sortKey: 'fullName' },
    { key: 'phone', header: 'Phone', hideOnMobile: true },
    { key: 'country', header: 'Country', hideOnMobile: true, sortKey: 'country' },
    // Group membership lives in a join table, so the API does not sort by it.
    { key: 'groups', header: 'Groups', hideOnMobile: true },
    { key: 'tags', header: 'Tags', hideOnMobile: true },
    { key: 'status', header: 'Status', sortKey: 'status' },
    {
      key: 'lastMessaged',
      header: 'Last messaged',
      align: 'right',
      hideOnMobile: true,
      sortKey: 'lastMessagedAt',
    },
    {
      key: 'createdAt',
      header: 'Created',
      align: 'right',
      hideOnMobile: true,
      sortKey: 'createdAt',
    },
  ];

  /**
   * Ordering, done by the API.
   *
   * The keys are the endpoint's allow-list (`ContactService.SortableColumns`).
   * An unknown key is a 422 naming the allowed values, so a typo here is loud
   * rather than silently unsorted.
   */
  protected readonly sorter = serverSorter({
    columns: [
      // Ordered by the real key, so `cnt_9` comes after `cnt_10` — the public
      // id is a rendering of that number, not the number itself.
      { key: 'id', label: 'ID' },
      { key: 'fullName', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'country', label: 'Country' },
      { key: 'createdAt', label: 'Created', initialDirection: 'desc' },
      { key: 'lastMessagedAt', label: 'Last messaged', initialDirection: 'desc' },
    ],
    load: () => {
      // A different order is a different first page.
      this.pager.reset();
      this.load();
    },
  });

  protected readonly hasFilters = computed(
    () =>
      this.search() !== '' ||
      this.status() !== 'all' ||
      this.groupId() !== 'all' ||
      this.tagId() !== 'all',
  );

  private readonly groupNameById = computed(() => {
    const lookup = new Map<string, ContactGroup>();
    for (const group of this.groups()) {
      lookup.set(group.id, group);
    }
    return lookup;
  });

  private readonly tagNameById = computed(() => {
    const lookup = new Map<string, ContactTag>();
    for (const tag of this.tags()) {
      lookup.set(tag.id, tag);
    }
    return lookup;
  });

  /**
   * Filters taken from the query string, bound by `withComponentInputBinding`
   * — `/contacts?group=grp_1`.
   *
   * "Open in Contacts" in the group and tag member dialogs lands here already
   * narrowed. Without it the link would drop somebody on the full list to
   * rebuild by hand the filter they had just been looking at.
   */
  readonly group = input<string | undefined>(undefined);
  readonly tag = input<string | undefined>(undefined);

  constructor() {
    // Only when a filter was actually asked for — the plain page is already
    // read from the bottom of this constructor, and a second read there would
    // be one request for nothing on every visit.
    effect(() => {
      const group = this.group();
      const tag = this.tag();

      untracked(() => {
        if (group === undefined && tag === undefined) {
          return;
        }
        this.groupId.set(group ?? 'all');
        this.tagId.set(tag ?? 'all');
        this.pager.reset();
        this.load();
      });
    });

    this.searchInput
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        this.pager.reset();
        this.load();
      });

    this.contactsService
      .listGroups()
      .subscribe({ next: (groups) => this.groups.set(groups) });
    this.contactsService
      .listTags()
      .subscribe({ next: (tags) => this.tags.set(tags) });
    this.load();
  }

  /**
   * The list read, cancelled whenever a newer one starts. Typing in the search
   * box, paging and filtering all reload; without this a slow earlier response
   * could land after a newer one and put the wrong rows under the filters on
   * screen.
   */
  private readonly listRequest = latestRequest();

  protected load(): void {
    this.state.set('loading');

    this.contactsService
      .list({
        page: this.pager.page(),
        pageSize: this.pager.pageSize(),
        search: this.search(),
        status: this.status(),
        groupId: this.groupId(),
        tagId: this.tagId(),
        sortBy: this.sorter.key(),
        sortDirection: this.sorter.direction(),
      })
      .pipe(this.listRequest.only())
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
    this.status.set(
      (event.target as HTMLSelectElement).value as ContactStatus | 'all',
    );
    this.pager.reset();
    this.load();
  }

  protected onGroupChange(event: Event): void {
    this.groupId.set((event.target as HTMLSelectElement).value);
    this.pager.reset();
    this.load();
  }

  protected onTagChange(event: Event): void {
    this.tagId.set((event.target as HTMLSelectElement).value);
    this.pager.reset();
    this.load();
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('all');
    this.groupId.set('all');
    this.tagId.set('all');
    this.pager.reset();
    this.load();
  }

  /** The names of the groups a contact belongs to, for its Groups cell. */
  protected groupNames(contact: Contact): readonly string[] {
    const lookup = this.groupNameById();
    return contact.groupIds
      .map((groupId) => lookup.get(groupId)?.name)
      .filter((name): name is string => name !== undefined);
  }

  /** Saves the contact open in the editor. */
  protected updateContact(request: UpdateContactRequest): void {
    if (this.saving()) {
      return;
    }

    const contact = this.editingContact();

    if (!contact) {
      return;
    }

    this.saving.set(true);
    this.editFieldErrors.set({});

    this.contactsService.update(contact.id, request).subscribe({
      next: (updatedContact) => {
        this.saving.set(false);
        this.editing.set(false);
        this.editingContact.set(null);

        this.toast.success(
          'Contact updated',
          `${updatedContact.fullName} has been updated.`,
        );

        this.load();
      },

      error: (error: ApiError) => {
        this.saving.set(false);

        if (Object.keys(error.fieldErrors).length > 0) {
          this.editFieldErrors.set(error.fieldErrors);
          return;
        }

        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected tagFor(tagId: string): ContactTag | undefined {
    return this.tagNameById().get(tagId);
  }

  /**
   * Every tag on a contact, for the overflow tooltip.
   *
   * The cell shows two and counts the rest, so without this the remaining
   * names are unreachable without opening the contact.
   */
  protected allTagNames(contact: Contact): readonly string[] {
    return contact.tagIds
      .map((tagId) => this.tagFor(tagId)?.name)
      .filter((name): name is string => name !== undefined);
  }

  /** Same list as a single string, for the native `title` fallback. */
  protected tagNameList(contact: Contact): string {
    return this.allTagNames(contact).join(', ');
  }

  /**
   * Applies a bulk result: report it and refresh the page.
   *
   * Still used by the row menu's Delete, which goes through the bulk endpoint
   * with one id so the server's rules live in one place.
   */
  private applyBulkResult(result: BulkOperationResult, outcome: string): void {
    this.busy.set(false);

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
    this.toast.error(
      `Could not ${action}`,
      'The request failed. Please try again.',
    );
  }

  /**
   * Exports what the filters currently select.
   *
   * One path now that rows cannot be ticked. There used to be two: a ticked
   * selection streamed straight back, and a filter went through the
   * asynchronous pipeline because it is unbounded — it can be every contact in
   * the workspace. The unbounded one is the case that has to work, so it is
   * the one that remains.
   */
  protected exportCsv(): void {
    if (this.busy()) {
      return;
    }

    this.queueFilteredExport();
  }

  /**
   * Everything matching the filters, as a background job.
   *
   * The list view's state goes with it — search, status, group, tag and the
   * current sort — so the file is of what is on screen rather than of the
   * whole table.
   */
  private queueFilteredExport(): void {
    this.busy.set(true);

    this.exports
      .create({
        dataset: 'contacts',
        format: 'csv',
        search: this.search(),
        filters: {
          status: this.status(),
          groupId: this.groupId(),
          tagId: this.tagId(),
        },
        // The view's own sort, so the file comes out in the order on screen.
        sortBy: this.sorter.key(),
        sortDirection: this.sorter.direction(),
      })
      .subscribe({
        next: (accepted) => {
          this.busy.set(false);
          this.exportNotifications.announceQueued('Contacts', accepted.reused, accepted.jobId);
        },
        error: () => this.failBulk('Export'),
      });
  }

  protected announcePending(action: string): void {
    this.toast.info(`${action}`, 'This flow lands with the next milestone.');
  }

  /* ------------------------------ create ------------------------------ */

  protected openCreate(): void {
    if (!this.gate.allow({ action: 'Adding a contact', module: 'crm' })) {
      return;
    }
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
        this.toast.success(
          'Contact added',
          `${contact.fullName} is now in your audience.`,
        );
        // Show the newcomer rather than leaving the user on a stale page.
        this.pager.reset();
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

  /* ---------------------------- one row ---------------------------- */

  /**
   * Edits the row whose menu was opened.
   *
   * Separate from {@link openEdit}, which acts on the selection. Editing one
   * contact used to mean ticking its box, reading the bar that appeared at the
   * bottom of the screen, and pressing Edit there — three steps and a mode,
   * for the most ordinary thing anybody does on this screen.
   */
  protected editRow(contact: Contact): void {
    if (!this.gate.allow({ action: 'Editing a contact', module: 'crm' })) {
      return;
    }
    if (this.saving()) {
      return;
    }

    this.editFieldErrors.set({});
    this.editingContact.set(contact);
    this.editing.set(true);
  }

  /**
   * Deletes the row whose menu was opened.
   *
   * Goes through the same bulk endpoint with one id: the server's rules about
   * what deleting a contact means are worth having in one place, and a
   * single-row route would be a second copy of them.
   */
  protected deleteRow(contact: Contact): void {
    if (!this.gate.allow({ action: 'Deleting contacts', module: 'crm' })) {
      return;
    }
    if (this.busy()) {
      return;
    }
    this.busy.set(true);

    this.contactsService.bulkDelete([contact.id]).subscribe({
      next: (result) => this.applyBulkResult(result, `${contact.fullName} deleted`),
      error: () => this.failBulk('delete that contact'),
    });
  }

  protected closeEdit(): void {
    this.editing.set(false);
    this.editingContact.set(null);
    this.editFieldErrors.set({});
  }
}
