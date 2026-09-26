import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError, LoadState } from '@core/models/api.model';
import type { ContactTag, ContactTagDraft } from '@core/models/contact.model';
import { ContactsService } from '@core/services/contacts.service';
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
import { clientSorter, type SortColumn } from '@shared/ui/data-table/sort';
import { SearchBoxComponent } from '@shared/ui/search-box/search-box.component';
import { SortMenuComponent } from '@shared/ui/data-table/sort-menu.component';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { clientPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { TagEditorComponent } from './tag-editor.component';

/**
 * What a tag can be ordered by.
 *
 * `ContactTag` has `createdAt` and nothing else from the audit set — no
 * updated pair, no "by" fields — so Created is the only audit column here.
 */
const TAG_SORT_COLUMNS: readonly SortColumn<ContactTag>[] = [
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
  private readonly auth = inject(AuthService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly tags = signal<readonly ContactTag[]>([]);
  protected readonly search = signal('');

  /**
   * Matched on the name, in the browser: the API returns every tag, and a
   * workspace with three hundred of them is a lot of cards to read through.
   */
  private readonly matching = computed(() => {
    const term = this.search().trim().toLowerCase();
    return term === ''
      ? this.tags()
      : this.tags().filter((tag) => tag.name.toLowerCase().includes(term));
  });

  /** Ordering in the browser: the API returns every tag. */
  protected readonly sorter = clientSorter(this.matching, TAG_SORT_COLUMNS);

  /** The API returns every tag; only one page of cards is rendered. */
  protected readonly pager = clientPager(this.sorter.rows);
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
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.contactsService.listTags().subscribe({
      next: (tags) => {
        this.tags.set(tags);
        this.state.set(tags.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected barWidth(tag: ContactTag): string {
    return `${Math.round((tag.contactCount / this.maxCount()) * 100)}%`;
  }

  protected openCreate(): void {
    this.nameError.set(null);
    this.editing.set('new');
  }

  protected openEdit(tag: ContactTag): void {
    this.nameError.set(null);
    this.editing.set(tag);
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
