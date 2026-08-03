import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import type { LoadState } from '@core/models/api.model';
import type { ContactGroup } from '@core/models/contact.model';
import { ContactsService } from '@core/services/contacts.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

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
  ],
  templateUrl: './groups.component.html',
})
export class GroupsComponent {
  private readonly contactsService = inject(ContactsService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly groups = signal<readonly ContactGroup[]>([]);
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];

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
}
