import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError, LoadState } from '@core/models/api.model';
import type { ContactGroup, ContactGroupDraft } from '@core/models/contact.model';
import { ContactsService } from '@core/services/contacts.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import {
  ContactListComponent,
  type ContactListSource,
} from '@shared/contacts/contact-list.component';
import { HistoryButtonComponent } from '@shared/audit/history-button.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { clientSorter, type SortColumn } from '@shared/ui/data-table/sort';
import { SearchBoxComponent } from '@shared/ui/search-box/search-box.component';
import { SortMenuComponent } from '@shared/ui/data-table/sort-menu.component';
import { clientPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { GroupEditorComponent } from './group-editor.component';

/**
 * What a group can be ordered by.
 *
 * `ContactGroup` carries `createdAt` and `updatedAt` and no "by" fields, so
 * those two are the audit columns — nothing is invented for the other two.
 */
const GROUP_SORT_COLUMNS: readonly SortColumn<ContactGroup>[] = [
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

@Component({
  selector: 'app-groups',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SearchBoxComponent,
    SortMenuComponent,
    RouterLink,
    ContactListComponent,
    ModalComponent,
    HistoryButtonComponent,
    PaginatorComponent,
    DecimalPipe,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    GroupEditorComponent,
  ],
  templateUrl: './groups.component.html',
})
export class GroupsComponent {
  private readonly contactsService = inject(ContactsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly groups = signal<readonly ContactGroup[]>([]);
  /**
   * Ordering, applied in the browser.
   *
   * `GET /contacts/groups` answers with the whole collection, so this sorts
   * every group and the pager then cuts a page out of the result — not the
   * other way round, which would only reorder the cards already on screen.
   */
  protected readonly search = signal('');

  /** Matched on the name and the description, in the browser. */
  private readonly matching = computed(() => {
    const term = this.search().trim().toLowerCase();
    return term === ''
      ? this.groups()
      : this.groups().filter(
          (group) =>
            group.name.toLowerCase().includes(term) ||
            group.description.toLowerCase().includes(term),
        );
  });

  protected readonly sorter = clientSorter(this.matching, GROUP_SORT_COLUMNS);

  /** The API returns every group; only one page of cards is rendered. */
  protected readonly pager = clientPager(this.sorter.rows);
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];

  /** `null` = closed, `'new'` = create, otherwise the group being renamed. */
  protected readonly editing = signal<ContactGroup | 'new' | null>(null);
  protected readonly confirmingDelete = signal<ContactGroup | null>(null);
  protected readonly saving = signal(false);
  protected readonly nameError = signal<string | null>(null);

  protected readonly canManage = computed(() => this.auth.hasPermission('groups.manage'));

  /**
   * The group whose contacts are on screen.
   *
   * The count answers "how many"; the question people have before sending is
   * "who", and answering it meant going to Contacts and rebuilding the filter
   * by hand.
   */
  protected readonly viewingMembers = signal<ContactGroup | null>(null);

  protected viewMembers(target: ContactGroup): void {
    this.viewingMembers.set(target);
  }

  /**
   * Reads the contacts behind the group on screen.
   *
   * A `computed`, so its identity only changes when the group does — the list
   * re-reads when its source changes, and a closure rebuilt on every change
   * detection would restart the request forever.
   */
  protected readonly membersSource = computed<ContactListSource>(() => {
    const target = this.viewingMembers();

    return (page, pageSize, search) =>
      this.contactsService.list({
        page,
        pageSize,
        search,
        status: 'all',
        groupId: target?.id ?? 'all',
        tagId: 'all',
      });
  });

  protected closeMembers(): void {
    this.viewingMembers.set(null);
  }


  protected readonly editorGroup = computed(() => {
    const target = this.editing();
    return target === null || target === 'new' ? null : target;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.contactsService.listGroups().subscribe({
      next: (groups) => {
        this.groups.set(groups);
        this.state.set(groups.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected openCreate(): void {
    this.nameError.set(null);
    this.editing.set('new');
  }

  protected openEdit(group: ContactGroup): void {
    this.nameError.set(null);
    this.editing.set(group);
  }

  protected closeEditor(): void {
    this.editing.set(null);
    this.nameError.set(null);
  }

  protected onSave(draft: ContactGroupDraft): void {
    const target = this.editing();
    if (target === null || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.nameError.set(null);

    const request$ =
      target === 'new'
        ? this.contactsService.createGroup(draft)
        : this.contactsService.updateGroup(target.id, draft);

    request$.subscribe({
      next: (group) => {
        this.saving.set(false);
        this.editing.set(null);
        this.toast.success(
          target === 'new' ? 'Group created' : 'Group updated',
          group.name,
        );
        this.load();
      },
      error: (error: ApiError) => {
        this.saving.set(false);

        // A duplicate name is a 409 with no field map, so it is placed on the
        // name input by hand rather than thrown at the user as a toast.
        if (error.errorCode === 'group_name_taken') {
          this.nameError.set(error.detail);
          return;
        }
        const fieldMessage = error.fieldErrors['name']?.[0];
        if (fieldMessage !== undefined) {
          this.nameError.set(fieldMessage);
          return;
        }
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected askDelete(group: ContactGroup): void {
    this.confirmingDelete.set(group);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected confirmDelete(): void {
    const group = this.confirmingDelete();
    if (group === null) {
      return;
    }

    this.contactsService.deleteGroup(group.id).subscribe({
      next: () => {
        this.confirmingDelete.set(null);
        this.toast.success('Group deleted', `${group.name} was removed. Contacts were kept.`);
        this.load();
      },
      // A group used by a scheduled campaign is refused, naming the campaign.
      error: (error: ApiError) => {
        this.confirmingDelete.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
