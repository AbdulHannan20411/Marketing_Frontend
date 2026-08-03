import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { LoadState } from '@core/models/api.model';
import type {
  MessageTemplate,
  TemplateCategory,
  TemplateStatus,
} from '@core/models/whatsapp.model';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { TemplateSegmentsPipe } from '@shared/pipes/template-segments.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { TEMPLATE_STATUS_TONE } from '@shared/ui/badge/campaign-status';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const CATEGORY_TONE: Readonly<Record<TemplateCategory, BadgeTone>> = {
  marketing: 'brand',
  utility: 'info',
  authentication: 'neutral',
};

type CategoryFilter = TemplateCategory | 'all';

@Component({
  selector: 'app-templates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    TemplateSegmentsPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './templates.component.html',
})
export class TemplatesComponent {
  private readonly whatsapp = inject(WhatsAppService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly templates = signal<readonly MessageTemplate[]>([]);
  protected readonly category = signal<CategoryFilter>('all');
  protected readonly syncing = signal(false);
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];

  protected readonly statusTone = TEMPLATE_STATUS_TONE;
  protected readonly categoryTone = CATEGORY_TONE;

  protected readonly categories: readonly { value: CategoryFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'marketing', label: 'Marketing' },
    { value: 'utility', label: 'Utility' },
    { value: 'authentication', label: 'Authentication' },
  ];

  protected readonly visibleTemplates = computed(() => {
    const filter = this.category();
    const all = this.templates();
    return filter === 'all' ? all : all.filter((template) => template.category === filter);
  });

  protected readonly approvedCount = computed(
    () => this.templates().filter((template) => template.status === 'approved').length,
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.whatsapp.listTemplates().subscribe({
      next: (templates) => {
        this.templates.set(templates);
        this.state.set(templates.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected sync(): void {
    this.syncing.set(true);
    this.whatsapp.syncTemplates().subscribe({
      next: (templates) => {
        this.templates.set(templates);
        this.syncing.set(false);
        this.toast.success('Templates synced', `${templates.length} templates pulled from Meta.`);
      },
      error: () => this.syncing.set(false),
    });
  }

  protected setCategory(value: CategoryFilter): void {
    this.category.set(value);
  }

  protected statusLabel(status: TemplateStatus): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
}
