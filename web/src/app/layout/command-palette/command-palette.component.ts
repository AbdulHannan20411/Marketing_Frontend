import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type { SearchResult, SearchResultGroup } from '@core/models/search.model';
import { LayoutService } from '@core/services/layout.service';
import { AuthService } from '@core/auth/auth.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { SearchService } from '@core/services/search.service';
import type { IconName } from '@shared/ui/icon/icon.registry';
import { IconComponent } from '@shared/ui/icon/icon.component';

/**
 * Command-palette search across every entity in the workspace.
 *
 * Opens on Ctrl/Cmd+K from anywhere in the shell. Arrow keys move through a
 * flattened result list so navigation crosses group boundaries naturally.
 */
interface PaletteSuggestion {
  readonly label: string;
  readonly icon: IconName;
  readonly route: string;
}

@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    '(document:keydown)': 'onGlobalKeydown($event)',
  },
  templateUrl: './command-palette.component.html',
})
export class CommandPaletteComponent {
  private readonly layout = inject(LayoutService);
  private readonly searchService = inject(SearchService);
  private readonly auth = inject(AuthService);
  private readonly scope = inject(AdminScopeService);
  private readonly router = inject(Router);
  private readonly queries = new Subject<string>();

  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  protected readonly isOpen = this.layout.commandPaletteOpen;
  protected readonly query = signal('');
  protected readonly groups = signal<readonly SearchResultGroup[]>([]);
  protected readonly searching = signal(false);
  /** The last search could not be run at all, as opposed to finding nothing. */
  protected readonly failed = signal(false);

  /** Platform staff outside a workspace search customers, not contacts. */
  protected readonly isPlatformSearch = computed(
    () => this.auth.isSuperAdmin() && !this.scope.isScoped(),
  );
  protected readonly activeIndex = signal(0);

  /** Flattened for keyboard traversal; the template still renders by group. */
  protected readonly flatResults = computed<readonly SearchResult[]>(() =>
    this.groups().flatMap((group) => group.results),
  );

  protected readonly hasQuery = computed(() => this.query().trim().length > 0);

  private readonly workspaceSuggestions: readonly PaletteSuggestion[] = [
    { label: 'Contacts', icon: 'users', route: '/contacts' },
    { label: 'Campaigns', icon: 'megaphone', route: '/campaigns' },
    { label: 'Subscription & usage', icon: 'sparkles', route: '/subscription' },
    { label: 'Billing history', icon: 'creditCard', route: '/billing' },
  ];

  /** Where platform staff actually go; none of the four above exist for them. */
  private readonly platformSuggestions: readonly PaletteSuggestion[] = [
    { label: 'Admin accounts', icon: 'building', route: '/superadmin/admins' },
    { label: 'Payment requests', icon: 'creditCard', route: '/superadmin/payments' },
    { label: 'Security across workspaces', icon: 'lock', route: '/superadmin/security' },
    { label: 'Subscription plans', icon: 'sparkles', route: '/admin/plans' },
  ];

  protected readonly suggestions = computed(() =>
    this.isPlatformSearch() ? this.platformSuggestions : this.workspaceSuggestions,
  );

  constructor() {
    this.queries
      .pipe(
        debounceTime(180),
        distinctUntilChanged(),
        /*
         * The catch is **inside** the switchMap on purpose.
         *
         * An error reaching the outer stream ends the subscription for good:
         * one failed search and every keystroke afterwards went into a dead
         * pipeline, leaving "Searching…" on screen forever. That is what the
         * `error` handler below could not fix — by the time it ran, the
         * stream it was meant to keep alive was already finished.
         */
        switchMap((term) =>
          this.searchService.search(term).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((groups) => {
        this.failed.set(groups === null);
        this.groups.set(groups ?? []);
        this.activeIndex.set(0);
        this.searching.set(false);
      });

    // Focus the input as soon as the palette opens.
    effect(() => {
      if (this.isOpen()) {
        queueMicrotask(() => this.searchBox()?.nativeElement.focus());
      }
    });
  }

  protected onGlobalKeydown(event: KeyboardEvent): void {
    const isPaletteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';

    if (isPaletteShortcut) {
      event.preventDefault();
      this.layout.openCommandPalette();
      return;
    }

    if (!this.isOpen()) {
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.move(-1);
        break;
      case 'Enter': {
        const result = this.flatResults()[this.activeIndex()];
        if (result !== undefined) {
          event.preventDefault();
          this.go(result);
        }
        break;
      }
      default:
        break;
    }
  }

  protected onInput(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.query.set(term);

    if (term.trim().length === 0) {
      this.groups.set([]);
      this.searching.set(false);
      return;
    }

    this.searching.set(true);
    this.failed.set(false);
    this.queries.next(term);
  }

  protected go(result: SearchResult): void {
    void this.router.navigateByUrl(result.route);
    this.close();
  }

  protected goTo(route: string): void {
    void this.router.navigateByUrl(route);
    this.close();
  }

  protected close(): void {
    this.layout.closeCommandPalette();
    this.query.set('');
    this.groups.set([]);
    this.activeIndex.set(0);
  }

  protected indexOf(result: SearchResult): number {
    return this.flatResults().indexOf(result);
  }

  private move(delta: number): void {
    const total = this.flatResults().length;
    if (total === 0) {
      return;
    }
    this.activeIndex.update((current) => (current + delta + total) % total);
  }
}
