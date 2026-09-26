import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError, LoadState } from '@core/models/api.model';
import type { ContactGroup, ContactGroupDraft } from '@core/models/contact.model';
import { latestRequest } from '@core/http/latest-request';
import { ContactsService, GROUP_SORT_COLUMNS } from '@core/services/contacts.service';
import { PlanGateService } from '@core/services/plan-gate.service';
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
import { serverSorter } from '@shared/ui/data-table/sort';
import { SearchBoxComponent } from '@shared/ui/search-box/search-box.component';
import { SortMenuComponent } from '@shared/ui/data-table/sort-menu.component';
import { serverPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { GroupEditorComponent } from './group-editor.component';

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
  private readonly gate = inject(PlanGateService);
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
  protected readonly totalItems = signal(0);
  /** False while `/groups` still answers with the whole collection. */
  protected readonly pagedByServer = signal(false);

  /** Keystrokes, before debouncing: one request per pause, not per letter. */
  private readonly searchInput = new Subject<string>();
  /** The page read, cancelled whenever a newer one starts. */
  private readonly listRequest = latestRequest();

  protected readonly pager = serverPager({
    total: this.totalItems,
    load: () => this.load(),
  });

  protected readonly sorter = serverSorter({
    columns: GROUP_SORT_COLUMNS.map(({ key, label, initialDirection }) => ({
      key,
      label,
      initialDirection,
    })),
    load: () => {
      this.pager.reset();
      this.load();
    },
  });
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
    this.searchInput
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        this.pager.reset();
        this.load();
      });

    this.load();
  }

  /**
   * One page, from the API.
   *
   * The page, the search and the order all go to the server. Where `/groups`
   * still answers with the whole collection the service applies them instead,
   * so this screen reads the same either way and needs no change when the
   * endpoint starts paging.
   */
  protected load(): void {
    this.state.set('loading');

    this.contactsService
      .pageGroups({
        page: this.pager.page(),
        pageSize: this.pager.pageSize(),
        search: this.search(),
        sortBy: this.sorter.key(),
        sortDirection: this.sorter.direction(),
      })
      .pipe(this.listRequest.only())
      .subscribe({
        next: (page) => {
          this.groups.set(page.items);
          this.totalItems.set(page.totalItems);
          this.pagedByServer.set(page.pagedByServer);
          this.state.set(page.totalItems === 0 ? 'empty' : 'ready');
        },
        error: () => this.state.set('error'),
      });
  }

  protected onSearch(term: string): void {
    this.searchInput.next(term);
  }

  protected openCreate(): void {
    if (!this.gate.allow({ action: 'Creating a group', module: 'crm' })) {
      return;
    }
    this.nameError.set(null);
    this.editing.set('new');
  }

  protected openEdit(group: ContactGroup): void {
    if (!this.gate.allow({ action: 'Editing a group', module: 'crm' })) {
      return;
    }
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
    if (!this.gate.allow({ action: 'Deleting a group', module: 'crm' })) {
      return;
    }
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
