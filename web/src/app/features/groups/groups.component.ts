import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError, LoadState } from '@core/models/api.model';
import type { ContactGroup, ContactGroupDraft } from '@core/models/contact.model';
import { ContactsService } from '@core/services/contacts.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { GroupEditorComponent } from './group-editor.component';

@Component({
  selector: 'app-groups',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];

  /** `null` = closed, `'new'` = create, otherwise the group being renamed. */
  protected readonly editing = signal<ContactGroup | 'new' | null>(null);
  protected readonly confirmingDelete = signal<ContactGroup | null>(null);
  protected readonly saving = signal(false);
  protected readonly nameError = signal<string | null>(null);

  protected readonly canManage = computed(() => this.auth.hasPermission('groups.manage'));

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
