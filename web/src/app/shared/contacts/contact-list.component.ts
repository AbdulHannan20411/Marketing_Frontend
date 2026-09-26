import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, type Observable } from 'rxjs';

import { latestRequest } from '@core/http/latest-request';
import type { ApiError, LoadState, PagedResult } from '@core/models/api.model';
import type { ContactStatus } from '@core/models/contact.model';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { serverPager } from '@shared/ui/pagination/pager';
import { PaginatorComponent } from '@shared/ui/pagination/paginator.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const STATUS_TONE: Readonly<Record<ContactStatus, BadgeTone>> = {
  subscribed: 'success',
  unsubscribed: 'neutral',
  blocked: 'danger',
};

/** The least a row needs to be rendered here. */
export interface ContactListRow {
  readonly id: string;
  readonly fullName: string;
  readonly initials: string;
  readonly phoneNumber: string;
  readonly status: ContactStatus;
  /** Absent from the campaign audience payload, which does not carry it. */
  readonly email?: string | null;
}

/**
 * Reads one page. The caller owns the request; this component owns the paging,
 * the states and the rendering.
 */
export type ContactListSource = (
  page: number,
  pageSize: number,
  search: string,
) => Observable<PagedResult<ContactListRow>>;

/**
 * Who is actually in a group, a tag, or a campaign's audience.
 *
 * A count answers "how many"; this answers "who", which is the question people
 * have before they send to them. Paging is always the server's — a group with
 * 40,000 members costs one page either way.
 *
 * The **request** is the caller's, passed in as `source`: the group and tag
 * dialogs read the contacts endpoint with a filter, and the campaign wizard
 * reads the audience endpoint, which is a different verb, a different body and
 * a deduplicated union. Everything after the response is the same, which is
 * why it lives here once.
 */
@Component({
  selector: 'app-contact-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AvatarComponent,
    BadgeComponent,
    IconComponent,
    PaginatorComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './contact-list.component.html',
})
export class ContactListComponent {
  private readonly request = latestRequest();

  /**
   * Where the rows come from.
   *
   * Must be **stable** — a `computed`, or a field — not an expression that
   * builds a new function on every change detection, which would restart the
   * read each time.
   */
  readonly source = input.required<ContactListSource>();
  readonly pageSize = input(8);
  /** Offers a search box, for a list too long to read through. */
  readonly searchable = input(false);
  readonly searchPlaceholder = input('Search by name, number or email');
  /** What the empty state says when the filter matches nobody. */
  readonly emptyMessage = input('Nobody here yet.');

  protected readonly rows = signal<readonly ContactListRow[]>([]);
  protected readonly total = signal(0);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorDetail = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly statusTone = STATUS_TONE;

  /** Keystrokes, before debouncing. */
  private readonly typed = new Subject<string>();

  protected readonly pager = serverPager({
    total: this.total,
    load: () => this.load(),
  });

  protected readonly skeletons = computed(() =>
    Array.from({ length: Math.min(this.pageSize(), 6) }, (_, index) => index),
  );

  /** True once a search has narrowed the list, for the empty state's wording. */
  protected readonly filtered = computed(() => this.search().trim().length > 0);

  constructor() {
    this.typed
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        this.search.set(term);
        this.pager.reset();
        this.load();
      });

    /*
     * Reads on creation, and again whenever the source changes — which is how
     * one instance serves a dialog whose group can be switched without the
     * dialog being torn down and rebuilt.
     */
    effect(() => {
      this.source();
      const size = this.pageSize();

      untracked(() => {
        this.search.set('');
        if (this.pager.pageSize() !== size) {
          // Sets the size, returns to page one and reloads, all three.
          this.pager.setPageSize(size);
          return;
        }
        // `reset` is deliberately silent, so the read is ours to make.
        this.pager.reset();
        this.load();
      });
    });
  }

  protected onSearch(value: string): void {
    this.typed.next(value);
  }

  protected load(): void {
    this.state.set('loading');

    this.source()(this.pager.page(), this.pager.pageSize(), this.search().trim())
      .pipe(this.request.only())
      .subscribe({
        next: (page) => {
          this.rows.set(page.items);
          this.total.set(page.totalItems);
          this.state.set(page.totalItems === 0 ? 'empty' : 'ready');
        },
        error: (error: ApiError) => {
          this.errorDetail.set(error.detail);
          this.state.set('error');
        },
      });
  }

  protected retry(): void {
    this.load();
  }
}
