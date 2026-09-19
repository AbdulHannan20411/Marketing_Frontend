import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, type Observable, map, of, switchMap, take, timer } from 'rxjs';

import { AuthService } from '@core/auth/auth.service';
import type { LoadState } from '@core/models/api.model';
import type { Permission } from '@core/models/permission.model';
import type { WhatsAppAccount, WhatsAppAccountList } from '@core/models/whatsapp-account.model';
import { WhatsAppAccountsService } from './whatsapp-accounts.service';

const STORAGE_PREFIX = 'vd.whatsapp.account.';

/** Anyone who can open a WhatsApp screen may list the numbers they can see. */
const WHATSAPP_PERMISSIONS: readonly Permission[] = [
  'whatsapp.connect',
  'whatsapp.templates.view',
  'whatsapp.inbox.view',
  'whatsapp.campaigns.create',
  'whatsapp.campaigns.reports',
];

/**
 * Which WhatsApp number the signed-in user is working on.
 *
 * The topbar selector writes it; the WhatsApp page, templates and the campaign
 * builder read it. The inbox has its own filter, because "All numbers" is the
 * useful default there.
 *
 * Resolution order when nothing is chosen: the user's own default, then the
 * workspace default, then the first number. The choice is remembered per user
 * and per browser, never on the server — it is a view preference, not data.
 */
@Injectable({ providedIn: 'root' })
export class WhatsAppContextService {
  private readonly service = inject(WhatsAppAccountsService);
  private readonly auth = inject(AuthService);

  readonly state = signal<LoadState>('idle');
  private readonly state$ = toObservable(this.state);
  readonly list = signal<WhatsAppAccountList | null>(null);

  private readonly chosenId = signal<string | null>(null);

  readonly accounts = computed<readonly WhatsAppAccount[]>(() => this.list()?.items ?? []);

  readonly selectedAccount = computed<WhatsAppAccount | null>(() => {
    const accounts = this.accounts();
    const list = this.list();
    return (
      accounts.find((account) => account.id === this.chosenId()) ??
      accounts.find((account) => account.id === list?.myDefaultAccountId) ??
      accounts.find((account) => account.isDefault) ??
      accounts[0] ??
      null
    );
  });

  readonly selectedAccountId = computed(() => this.selectedAccount()?.id ?? null);

  /** A selector with one entry is noise; it only earns its space with two or more. */
  readonly hasMultiple = computed(() => this.accounts().length > 1);

  /** The number new work defaults to: the user's default, else the workspace's. */
  readonly defaultAccount = computed<WhatsAppAccount | null>(() => {
    const accounts = this.accounts();
    const list = this.list();
    return (
      accounts.find((account) => account.id === list?.myDefaultAccountId) ??
      accounts.find((account) => account.isDefault) ??
      accounts[0] ??
      null
    );
  });

  /** Whether this user may see any WhatsApp screen at all; nothing is requested otherwise. */
  canUseWhatsApp(): boolean {
    return this.auth.hasAnyPermission(WHATSAPP_PERMISSIONS);
  }

  load(): void {
    if (!this.canUseWhatsApp()) {
      // Requesting anyway would 403 on every page load for an employee with no
      // WhatsApp access at all — a toast they can do nothing about.
      this.list.set(null);
      this.state.set('idle');
      return;
    }

    this.chosenId.set(this.restore());
    this.state.set(this.list() === null ? 'loading' : this.state());

    this.service.list().subscribe({
      next: (list) => {
        this.list.set(list);
        this.state.set(list.items.length === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  /**
   * The selected number, once it is known.
   *
   * A call made before the list arrives would go out with no `accountId`, which
   * the API reads as "the workspace default" — and an employee who cannot view
   * the default then gets a 403 on their first screen. So number-specific calls
   * wait for the list.
   *
   * `idle` is either the moment before the shell asks for the list or a
   * workspace with no WhatsApp at all. It gets a short grace period, after which
   * the call goes ahead without a number, exactly as before. Loading itself has
   * no deadline.
   */
  resolvedAccountId(): Observable<string | null> {
    const settled = (state: LoadState): boolean => state === 'ready' || state === 'empty' || state === 'error';
    if (settled(this.state())) {
      return of(this.selectedAccountId());
    }
    return this.state$.pipe(
      switchMap((state) =>
        settled(state) ? of(true) : state === 'idle' ? timer(1500).pipe(map(() => true)) : EMPTY,
      ),
      take(1),
      map(() => this.selectedAccountId()),
    );
  }

  select(id: string): void {
    if (!this.accounts().some((account) => account.id === id)) {
      return;
    }
    this.chosenId.set(id);
    this.persist(id);
  }

  /** Folds one updated account back in without a reload. */
  replace(updated: WhatsAppAccount): void {
    this.list.update((list) =>
      list === null
        ? list
        : { ...list, items: list.items.map((entry) => (entry.id === updated.id ? updated : entry)) },
    );
  }

  /** For responses that return every account, such as changing the default. */
  replaceAll(accounts: readonly WhatsAppAccount[]): void {
    this.list.update((list) => (list === null ? list : { ...list, items: accounts }));
  }

  clear(): void {
    this.list.set(null);
    this.chosenId.set(null);
    this.state.set('idle');
  }

  private storageKey(): string | null {
    const id = this.auth.user()?.id;
    return id === undefined ? null : `${STORAGE_PREFIX}${id}`;
  }

  private restore(): string | null {
    const key = this.storageKey();
    if (key === null) {
      return null;
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private persist(id: string): void {
    const key = this.storageKey();
    if (key === null) {
      return;
    }
    try {
      localStorage.setItem(key, id);
    } catch {
      // A blocked storage only costs the remembered choice.
    }
  }
}
