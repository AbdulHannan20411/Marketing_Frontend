import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import type { AdminAccount } from '@core/models/admin-account.model';

const SCOPE_KEY = 'vd.superadmin.scope';

/**
 * Which Admin the Super Admin is currently viewing "as".
 *
 * `null` means the global, platform-wide view. Every scoped service reads this
 * one signal, so selecting an Admin re-scopes the whole portal without any
 * page needing to know how scoping works.
 *
 * Only ever populated for SuperAdmin; the accessors below hard-gate on role so
 * an Admin session can never carry a scope even if storage were tampered with.
 */
@Injectable({ providedIn: 'root' })
export class AdminScopeService {
  private readonly auth = inject(AuthService);

  private readonly selection = signal<AdminAccount | null>(this.restore());

  /** The selected Admin, or `null` for the global view. */
  readonly selected = computed(() =>
    this.auth.isSuperAdmin() ? this.selection() : null,
  );

  readonly selectedId = computed(() => this.selected()?.id ?? null);
  readonly isScoped = computed(() => this.selected() !== null);

  /** Label for the scope bar: the org being viewed, or the global view. */
  readonly scopeLabel = computed(() => this.selected()?.organisation ?? 'All admins');

  constructor() {
    effect(() => {
      const current = this.selection();
      if (current === null) {
        localStorage.removeItem(SCOPE_KEY);
      } else {
        localStorage.setItem(SCOPE_KEY, JSON.stringify(current));
      }
    });
  }

  select(admin: AdminAccount): void {
    this.selection.set(admin);
  }

  clear(): void {
    this.selection.set(null);
  }

  private restore(): AdminAccount | null {
    const raw = localStorage.getItem(SCOPE_KEY);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as AdminAccount;
    } catch {
      localStorage.removeItem(SCOPE_KEY);
      return null;
    }
  }
}
