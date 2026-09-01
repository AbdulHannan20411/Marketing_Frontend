import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import type { ApiError, LoadState } from '@core/models/api.model';
import type {
  MessageTemplate,
  TemplateCategory,
  TemplateCategoryFilter,
  TemplateDraft,
  TemplateStatus,
  TemplateStatusCounts,
  TemplateStatusFilter,
} from '@core/models/whatsapp.model';
import {
  TEMPLATE_CATEGORY_LABEL,
  TEMPLATE_STATUS_LABEL,
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
import { DEFAULT_PAGE_SIZE, PaginationComponent } from '@shared/ui/pagination/pagination.component';
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

const STATUS_ORDER: readonly TemplateStatus[] = ['approved', 'pending', 'rejected', 'paused'];

@Component({
  selector: 'app-templates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    TemplateSegmentsPipe,
    PageHeaderComponent,
    PaginationComponent,
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
  protected readonly syncing = signal(false);
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];

  /* ---------------------------- query state ---------------------------- */

  protected readonly search = signal('');
  protected readonly status = signal<TemplateStatusFilter>('all');
  protected readonly category = signal<TemplateCategoryFilter>('all');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  protected readonly totalItems = signal(0);

  /** Counts across the whole collection, not just this page. */
  protected readonly counts = signal<TemplateStatusCounts | null>(null);

  /**
   * Typing must not fire a request per keystroke, and the results must not
   * arrive out of order. `distinctUntilChanged` also stops a request when the
   * user types a character and deletes it again.
   */
  private readonly searchInput = new Subject<string>();

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

  protected readonly categories: readonly { value: TemplateCategoryFilter; label: string }[] = [
    { value: 'all', label: 'All categories' },
    { value: 'marketing', label: TEMPLATE_CATEGORY_LABEL.marketing },
    { value: 'utility', label: TEMPLATE_CATEGORY_LABEL.utility },
    { value: 'authentication', label: TEMPLATE_CATEGORY_LABEL.authentication },
  ];

  /**
   * The status chips, each with its count under the *other* active filters.
   *
   * `count` is `null` only when the counts endpoint has not answered — a real
   * zero renders as "0" so that an empty list is explained rather than
   * contradicted.
   */
  protected readonly statusOptions = computed(() => {
    const counts = this.counts();

    return [
      { value: 'all' as TemplateStatusFilter, label: 'All', count: counts?.total ?? null },
      ...STATUS_ORDER.map((value) => ({
        value: value as TemplateStatusFilter,
        label: TEMPLATE_STATUS_LABEL[value],
        count: counts === null ? null : counts[value],
      })),
    ];
  });

  /** True when any filter is narrowing the list — drives the "clear" affordance. */
  protected readonly isFiltered = computed(
    () => this.search().trim() !== '' || this.status() !== 'all' || this.category() !== 'all',
  );

  constructor() {
    this.searchInput
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        this.page.set(1);
        // Searching narrows what the counts describe, so they move with it.
        this.refresh();
      });

    this.load();
    this.loadCounts();
  }

  protected load(): void {
    this.state.set('loading');

    this.whatsapp
      .listTemplates({
        page: this.page(),
        pageSize: this.pageSize(),
        search: this.search(),
        status: this.status(),
        category: this.category(),
      })
      .subscribe({
        next: (result) => {
          this.templates.set(result.items);
          this.totalItems.set(result.totalItems);
          this.state.set(result.totalItems === 0 ? 'empty' : 'ready');

          // Counts computed alongside the list are exact, because they came
          // from the same array under the same filters. Preferred over the
          // endpoint, which today counts the whole workspace regardless of
          // search or category — the cause of a chip reading "Pending 1" over
          // an empty list.
          if (result.counts !== undefined) {
            this.hasExactCounts = true;
            this.counts.set(result.counts);
          }
        },
        error: () => this.state.set('error'),
      });
  }

  /**
   * Counts are a separate call because they span every page, and a single page
   * cannot produce them. They are refreshed whenever **search or category**
   * changes, but not when status changes — the numbers must hold still while
   * the operator clicks between statuses, which is the whole reason status is
   * excluded from the query.
   *
   * A failure is silent: the chips lose their numbers rather than the screen
   * showing an error for what is, in the end, decoration.
   */
  private loadCounts(): void {
    this.whatsapp.countTemplates({ search: this.search(), category: this.category() }).subscribe({
      // Only adopted if the list did not already supply exact counts. Whichever
      // arrives second must not overwrite a better answer.
      next: (counts) => {
        if (!this.hasExactCounts) {
          this.counts.set(counts);
        }
      },
      error: () => {
        if (!this.hasExactCounts) {
          this.counts.set(null);
        }
      },
    });
  }

  /** True once a list response has supplied counts derived from the full set. */
  private hasExactCounts = false;

  protected sync(): void {
    this.syncing.set(true);
    this.whatsapp.syncTemplates().subscribe({
      next: (templates) => {
        this.syncing.set(false);
        this.toast.success('Templates synced', `${templates.length} templates pulled from Meta.`);
        // Refetch rather than adopt the response: it is the full collection,
        // and this screen is showing one filtered page of it.
        this.refresh();
      },
      error: () => this.syncing.set(false),
    });
  }

  /**
   * Reloads the page and the counts together.
   *
   * Anything that adds or removes a template changes both, and refreshing only
   * the list would leave the status chips quietly stale.
   */
  private refresh(): void {
    this.load();
    this.loadCounts();
  }

  protected setCategory(value: TemplateCategoryFilter): void {
    this.category.set(value);
    this.page.set(1);
    this.refresh();
  }

  protected setStatus(value: TemplateStatusFilter): void {
    this.status.set(value);
    this.page.set(1);
    this.load();
  }

  protected onSearch(event: Event): void {
    this.searchInput.next((event.target as HTMLInputElement).value);
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    this.load();
  }

  /** Back to the unfiltered list, from the empty state. */
  protected clearFilters(): void {
    this.search.set('');
    this.status.set('all');
    this.category.set('all');
    this.page.set(1);
    this.refresh();
  }

  protected statusLabel(status: TemplateStatus): string {
    return TEMPLATE_STATUS_LABEL[status];
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
        this.refresh();
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
        // Deleting the last card on a page would strand the operator on an
        // empty page, so step back when this was the only one left.
        if (this.templates().length === 1 && this.page() > 1) {
          this.page.update((current) => current - 1);
        }
        this.refresh();
        this.toast.success('Template deleted', `${template.name} was removed from Meta.`);
      },
      error: (error: ApiError) => {
        this.saving.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }
}
