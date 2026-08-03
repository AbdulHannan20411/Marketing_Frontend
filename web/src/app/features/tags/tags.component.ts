import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import type { LoadState } from '@core/models/api.model';
import type { ContactTag } from '@core/models/contact.model';
import { ContactsService } from '@core/services/contacts.service';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

@Component({
  selector: 'app-tags',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './tags.component.html',
})
export class TagsComponent {
  private readonly contactsService = inject(ContactsService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly tags = signal<readonly ContactTag[]>([]);
  protected readonly skeletons = [1, 2, 3, 4, 5, 6, 7, 8];

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
}
