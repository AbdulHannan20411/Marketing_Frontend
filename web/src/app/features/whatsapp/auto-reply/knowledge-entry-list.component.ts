import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import {
  countByKind,
  KNOWLEDGE_KIND_COPY,
  KNOWLEDGE_KINDS,
  type KnowledgeEntry,
  type KnowledgeKind,
} from '@core/models/auto-reply-knowledge.model';

/** Rows shown before "Show all" — enough to recognise the file without a wall of text. */
const COLLAPSED = 6;

/**
 * The assistant's entries, filterable by type. Used for both the saved
 * knowledge and the preview of a file about to replace it.
 */
@Component({
  selector: 'app-knowledge-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
      <button type="button" [class]="chipClass(filter() === null)" [attr.aria-pressed]="filter() === null" (click)="choose(null)">
        All <span class="tabular-nums opacity-70">{{ entries().length }}</span>
      </button>
      @for (kind of kinds(); track kind) {
        <button type="button" [class]="chipClass(filter() === kind)" [attr.aria-pressed]="filter() === kind" (click)="choose(kind)">
          {{ copy[kind].plural }} <span class="tabular-nums opacity-70">{{ counts()[kind] }}</span>
        </button>
      }
    </div>

    <ul class="mt-3 divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line ring-inset">
      @for (entry of visible(); track $index) {
        <li class="px-3.5 py-3 transition-colors hover:bg-surface-muted/60">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line ring-inset">
              {{ copy[entry.kind].option }}
            </span>
            <p class="min-w-0 text-sm font-medium break-words text-ink">{{ entry.title }}</p>
            @if (entry.price) {
              <span class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-200 ring-inset">
                {{ entry.price }}
              </span>
            }
            @if (entry.available === false) {
              <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">
                Not available
              </span>
            }
          </div>
          @if (entry.answer) {
            <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">{{ entry.answer }}</p>
          }
          @if (entry.keywords.length > 0) {
            <p class="mt-1 text-[11px] text-ink-muted">Also asked as: {{ entry.keywords.join(', ') }}</p>
          }
        </li>
      }
    </ul>

    @if (hidden() > 0) {
      <button
        type="button"
        class="mt-2 text-xs font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-600"
        (click)="expanded.set(true)"
      >
        Show all {{ filtered().length }}
      </button>
    }
  `,
})
export class KnowledgeEntryListComponent {
  readonly entries = input.required<readonly KnowledgeEntry[]>();

  protected readonly copy = KNOWLEDGE_KIND_COPY;
  protected readonly filter = signal<KnowledgeKind | null>(null);
  protected readonly expanded = signal(false);

  protected readonly counts = computed(() => countByKind(this.entries()));
  /** Only the types the file actually has. */
  protected readonly kinds = computed(() => KNOWLEDGE_KINDS.filter((kind) => this.counts()[kind] > 0));

  protected readonly filtered = computed(() => {
    const kind = this.filter();
    return kind === null ? this.entries() : this.entries().filter((entry) => entry.kind === kind);
  });
  protected readonly visible = computed(() =>
    this.expanded() ? this.filtered() : this.filtered().slice(0, COLLAPSED),
  );
  protected readonly hidden = computed(() => this.filtered().length - this.visible().length);

  protected choose(kind: KnowledgeKind | null): void {
    this.filter.set(kind);
    this.expanded.set(false);
  }

  protected chipClass(active: boolean): string {
    return (
      'rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-brand-600 ' +
      (active ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'bg-surface text-ink-soft ring-line hover:ring-brand-200')
    );
  }
}
