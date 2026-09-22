import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

import type { ApiError, LoadState } from '@core/models/api.model';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_COPY,
  auditActorName,
  type AuditAction,
  type AuditEntry,
} from '@core/models/audit-history.model';
import { AuditHistoryService } from '@core/services/audit-history.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { serverPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

/** Options in the "who" filter, built from what the history actually contains. */
interface ActorOption {
  readonly id: string;
  readonly name: string;
}

/**
 * One record's history: created, updated, deleted — who, when, and the fields
 * that moved, old value beside new.
 *
 * Generic on purpose. It takes the entity's name and id and nothing else, so
 * the same component serves templates, employees, settings and whatever comes
 * next; the fields, their wording and their values all come from the API.
 *
 * Usable on its own — inside a tab or a details page — or through
 * `<app-history-button>`, which opens it in the app's modal.
 */
@Component({
  selector: 'app-audit-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    DatePipe,
    TimeAgoPipe,
    ButtonDirective,
    IconComponent,
    PaginatorComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './audit-history.component.html',
})
export class AuditHistoryComponent {
  /** As the API names it: `Template`, `Employee`, `Contact`. */
  readonly entityName = input.required<string>();
  readonly entityId = input.required<string>();
  /** What the record is called, for the empty state's wording. */
  readonly recordLabel = input<string | null>(null);

  private readonly audit = inject(AuditHistoryService);

  protected readonly actions = AUDIT_ACTIONS;
  protected readonly actionCopy = AUDIT_ACTION_COPY;
  protected readonly skeletons = [1, 2, 3];
  protected readonly actorName = auditActorName;

  protected readonly state = signal<LoadState>('loading');
  /**
   * A refetch with something already on screen — a filter or a page change.
   * The list stays put and dims, rather than being replaced by skeletons and
   * then by content, which read as the dialog flashing and resizing.
   */
  protected readonly refreshing = signal(false);
  protected readonly entries = signal<readonly AuditEntry[]>([]);
  protected readonly totalItems = signal(0);
  /** Present when the API has no audit endpoint yet, so the panel can say so. */
  protected readonly unsupported = signal(false);

  protected readonly action = signal<AuditAction | 'all'>('all');
  protected readonly userId = signal<string>('');
  protected readonly from = signal<string>('');
  protected readonly to = signal<string>('');

  protected readonly pager = serverPager({
    total: this.totalItems,
    pageSize: 10,
    load: () => this.load(),
  });

  protected readonly hasFilters = computed(
    () => this.action() !== 'all' || this.userId() !== '' || this.from() !== '' || this.to() !== '',
  );

  /**
   * The people in the loaded history, for the "who" filter.
   *
   * From the page rather than a separate call: an entity's history is short,
   * and a list of every user in the workspace would mostly be people who never
   * touched this record.
   */
  protected readonly actors = computed<readonly ActorOption[]>(() => {
    const seen = new Map<string, string>();
    for (const entry of this.entries()) {
      if (entry.userId !== null && !seen.has(entry.userId)) {
        seen.set(entry.userId, auditActorName(entry));
      }
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  });

  constructor() {
    // Reloads when the host points the panel at a different record.
    effect(() => {
      const target = `${this.entityName()}/${this.entityId()}`;
      untracked(() => {
        if (target.endsWith('/') || target.startsWith('/')) {
          return;
        }
        this.pager.reset();
        this.load();
      });
    });
  }

  protected load(): void {
    if (this.entries().length > 0) {
      this.refreshing.set(true);
    } else {
      this.state.set('loading');
    }
    this.audit
      .history(this.entityName(), this.entityId(), {
        page: this.pager.page(),
        pageSize: this.pager.pageSize(),
        action: this.action(),
        userId: this.userId() === '' ? null : this.userId(),
        from: this.from() === '' ? null : this.from(),
        to: this.to() === '' ? null : this.to(),
      })
      .subscribe({
        next: (page) => {
          this.refreshing.set(false);
          this.entries.set(page.items);
          this.totalItems.set(page.totalItems);
          this.unsupported.set(false);
          this.state.set(page.totalItems === 0 ? 'empty' : 'ready');
        },
        error: (error: ApiError) => {
          this.refreshing.set(false);
          // 404 is "this API version has no history endpoint"; 403 is a real
          // refusal and says so through the error state's own wording.
          this.unsupported.set(error.status === 404);
          this.state.set(error.status === 404 ? 'empty' : 'error');
        },
      });
  }

  protected setAction(value: AuditAction | 'all'): void {
    this.action.set(value);
    this.pager.reset();
    this.load();
  }

  protected setUser(value: string): void {
    this.userId.set(value);
    this.pager.reset();
    this.load();
  }

  protected setFrom(value: string): void {
    this.from.set(value);
    this.pager.reset();
    this.load();
  }

  protected setTo(value: string): void {
    this.to.set(value);
    this.pager.reset();
    this.load();
  }

  protected clearFilters(): void {
    this.action.set('all');
    this.userId.set('');
    this.from.set('');
    this.to.set('');
    this.pager.reset();
    this.load();
  }
}
