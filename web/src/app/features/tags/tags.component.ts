import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError, LoadState } from '@core/models/api.model';
import type { ContactTag, ContactTagDraft } from '@core/models/contact.model';
import { latestRequest } from '@core/http/latest-request';
import { ContactsService, TAG_SORT_COLUMNS } from '@core/services/contacts.service';
import { PlanGateService } from '@core/services/plan-gate.service';
import { ToastService } from '@core/services/toast.service';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
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
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { serverPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { TagEditorComponent } from './tag-editor.component';

@Component({
  selector: 'app-tags',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SearchBoxComponent,
    SortMenuComponent,
    TimeAgoPipe,
    RouterLink,
    ContactListComponent,
    ModalComponent,
    HistoryButtonComponent,
    PaginatorComponent,
    DecimalPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    TagEditorComponent,
  ],
  templateUrl: './tags.component.html',
})
export class TagsComponent {
  private readonly contactsService = inject(ContactsService);
  private readonly toast = inject(ToastService);
  private readonly gate = inject(PlanGateService);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly tags = signal<readonly ContactTag[]>([]);
  protected readonly search = signal('');
  protected readonly totalItems = signal(0);
  /** False while `/tags` still answers with the whole collection. */
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
    columns: TAG_SORT_COLUMNS.map(({ key, label, initialDirection }) => ({
      key,
      label,
      initialDirection,
    })),
    load: () => {
      this.pager.reset();
      this.load();
    },
  });
  protected readonly skeletons = [1, 2, 3, 4, 5, 6, 7, 8];

  protected readonly editing = signal<ContactTag | 'new' | null>(null);
  protected readonly confirmingDelete = signal<ContactTag | null>(null);
  protected readonly saving = signal(false);
  protected readonly nameError = signal<string | null>(null);

  protected readonly canManage = computed(() => this.auth.hasPermission('tags.manage'));

  /**
   * The tag whose contacts are on screen.
   *
   * The count answers "how many"; the question people have before sending is
   * "who", and answering it meant going to Contacts and rebuilding the filter
   * by hand.
   */
  protected readonly viewingMembers = signal<ContactTag | null>(null);

  protected viewMembers(target: ContactTag): void {
    this.viewingMembers.set(target);
  }

  /**
   * Reads the contacts behind the tag on screen.
   *
   * A `computed`, so its identity only changes when the tag does — the list
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
        groupId: 'all',
        tagId: target?.id ?? 'all',
      });
  });

  protected closeMembers(): void {
    this.viewingMembers.set(null);
  }


  protected readonly editorTag = computed(() => {
    const target = this.editing();
    return target === null || target === 'new' ? null : target;
  });

  /** Widest tag drives the bar scale so relative usage is readable at a glance. */
  protected readonly maxCount = computed(() =>
    Math.max(1, ...this.tags().map((tag) => tag.contactCount)),
  );

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
   * Every parameter goes to the server — the page, the search and the order.
   * Where `/tags` still answers with the whole collection the service applies
   * them here instead, so this screen reads the same either way and needs no
   * change when the endpoint starts paging.
   */
  protected load(): void {
    this.state.set('loading');

    this.contactsService
      .pageTags({
        page: this.pager.page(),
        pageSize: this.pager.pageSize(),
        search: this.search(),
        sortBy: this.sorter.key(),
        sortDirection: this.sorter.direction(),
      })
      .pipe(this.listRequest.only())
      .subscribe({
        next: (page) => {
          this.tags.set(page.items);
          this.totalItems.set(page.totalItems);
          this.pagedByServer.set(page.pagedByServer);
          this.state.set(page.totalItems === 0 ? 'empty' : 'ready');
        },
        error: () => this.state.set('error'),
      });
  }

  protected barWidth(tag: ContactTag): string {
    return `${Math.round((tag.contactCount / this.maxCount()) * 100)}%`;
  }

  protected openCreate(): void {
    // Before the form, not after it: nobody should name a tag, pick a colour
    // and then be told the plan does not cover it.
    if (!this.gate.allow({ action: 'Creating a tag', module: 'crm' })) {
      return;
    }
    this.nameError.set(null);
    this.editing.set('new');
  }

  protected openEdit(tag: ContactTag): void {
    if (!this.gate.allow({ action: 'Editing a tag', module: 'crm' })) {
      return;
    }
    this.nameError.set(null);
    this.editing.set(tag);
  }

  protected onSearch(term: string): void {
    this.searchInput.next(term);
  }

  protected closeEditor(): void {
    this.editing.set(null);
    this.nameError.set(null);
  }

  protected onSave(draft: ContactTagDraft): void {
    const target = this.editing();
    if (target === null || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.nameError.set(null);

    const request$ =
      target === 'new'
        ? this.contactsService.createTag(draft)
        : this.contactsService.updateTag(target.id, draft);

    request$.subscribe({
      next: (tag) => {
        this.saving.set(false);
        this.editing.set(null);
        this.toast.success(target === 'new' ? 'Tag created' : 'Tag updated', tag.name);
        this.load();
      },
      error: (error: ApiError) => {
        this.saving.set(false);

        // Duplicate names come back as a 409 without a field map.
        if (error.errorCode === 'tag_name_taken') {
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

  protected askDelete(tag: ContactTag): void {
    if (!this.gate.allow({ action: 'Deleting a tag', module: 'crm' })) {
      return;
    }
    this.confirmingDelete.set(tag);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected confirmDelete(): void {
    const tag = this.confirmingDelete();
    if (tag === null) {
      return;
    }

    this.contactsService.deleteTag(tag.id).subscribe({
      next: () => {
        this.confirmingDelete.set(null);
        this.toast.success('Tag deleted', `${tag.name} was removed from every contact.`);
        this.load();
      },
      error: (error: ApiError) => {
        this.confirmingDelete.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
