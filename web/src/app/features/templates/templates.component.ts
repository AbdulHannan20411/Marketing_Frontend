import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  MessageTemplate,
  TemplateCategory,
  TemplateDraft,
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
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { TemplateEditorComponent } from './template-editor.component';

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
    ModalComponent,
    TemplateEditorComponent,
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

  /** `null` closed, `'new'` composing, otherwise the rejected template being reworked. */
  protected readonly editing = signal<MessageTemplate | 'new' | null>(null);
  protected readonly deleting = signal<MessageTemplate | null>(null);
  protected readonly saving = signal(false);

  protected readonly editorTemplate = computed(() => {
    const target = this.editing();
    return target === null || target === 'new' ? null : target;
  });

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

  /* ------------------------------ authoring ------------------------------ */

  protected compose(): void {
    this.editing.set('new');
  }

  /**
   * Only a rejected template can be reworked. Meta treats an approved one as
   * immutable, so "edit" elsewhere would promise something it cannot deliver.
   */
  protected resubmit(template: MessageTemplate): void {
    if (template.status !== 'rejected') {
      return;
    }
    this.editing.set(template);
  }

  protected closeEditor(): void {
    this.editing.set(null);
  }

  protected submitTemplate(draft: TemplateDraft): void {
    const target = this.editing();
    if (target === null || this.saving()) {
      return;
    }
    this.saving.set(true);

    const request$ =
      target === 'new'
        ? this.whatsapp.createTemplate(draft)
        : this.whatsapp.updateTemplate(target.id, draft);

    request$.subscribe({
      next: (template) => {
        this.saving.set(false);
        this.editing.set(null);
        this.templates.update((current) =>
          target === 'new'
            ? [template, ...current]
            : current.map((entry) => (entry.id === template.id ? template : entry)),
        );
        this.toast.success(
          'Sent to Meta for review',
          `${template.name} is pending. Approval usually takes a few minutes.`,
        );
      },
      // A duplicate name or a policy rejection arrives as 409 with the reason.
      error: (error: ApiError) => {
        this.saving.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected confirmDelete(template: MessageTemplate): void {
    this.deleting.set(template);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected remove(): void {
    const template = this.deleting();
    if (template === null || this.saving()) {
      return;
    }
    this.saving.set(true);

    this.whatsapp.deleteTemplate(template.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.deleting.set(null);
        this.templates.update((current) => current.filter((entry) => entry.id !== template.id));
        this.toast.success('Template deleted', `${template.name} was removed from Meta.`);
      },
      error: (error: ApiError) => {
        this.saving.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
