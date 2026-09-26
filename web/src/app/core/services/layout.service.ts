import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { NAVIGATION } from '@core/config/navigation.config';
import { SUPERADMIN_NAVIGATION } from '@core/config/superadmin-navigation.config';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import type { NavSection } from '@core/models/navigation.model';

const COLLAPSE_KEY = 'vd.sidebar.collapsed';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly auth = inject(AuthService);
  private readonly scope = inject(AdminScopeService);

  readonly sidebarCollapsed = signal(localStorage.getItem(COLLAPSE_KEY) === 'true');
  readonly mobileNavOpen = signal(false);
  readonly commandPaletteOpen = signal(false);

  /**
   * Navigation filtered to what the signed-in user is **allowed to see** —
   * which is not the same as what their plan covers.
   *
   * A screen outside the plan still appears and still opens, read-only; the
   * plan is enforced on the actions, where the upgrade can be offered. See
   * `PlanGateService`.
   *
   * Super Admins get their own portal's navigation instead — no permission or
   * plan filtering applies to them.
   */
  readonly visibleNavigation = computed<readonly NavSection[]>(() => {
    if (this.auth.isSuperAdmin()) {
      // Workspace tabs (Contacts, Tags, WhatsApp…) mean nothing platform-wide;
      // they appear only while viewing as a selected Admin.
      const scoped = this.scope.isScoped();
      return SUPERADMIN_NAVIGATION.map((section) => ({
        ...section,
        items: section.items.filter((item) => scoped || item.requiresScope !== true),
      })).filter((section) => section.items.length > 0);
    }

    /*
     * Filtered by **permission and role only**.
     *
     * Not by plan: a screen the plan does not cover still opens, read-only,
     * and the upgrade is offered at the moment somebody tries to change
     * something — see `PlanGateService`. Hiding those screens removed the
     * reason to buy them and made two thirds of the product look broken
     * rather than upgradeable.
     *
     * Permission is different in kind and still hides: an employee without
     * `contacts.view` is not a customer who might upgrade, they are somebody
     * this workspace decided should not see contacts.
     */
    return NAVIGATION.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          this.auth.hasAnyPermission(item.permissions) &&
          (item.roles === undefined || this.auth.hasRole(item.roles)),
      ),
    })).filter((section) => section.items.length > 0);
  });

  constructor() {
    effect(() => localStorage.setItem(COLLAPSE_KEY, String(this.sidebarCollapsed())));
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.update((open) => !open);
  }

  /** Used by the product tour: sidebar links do not exist until the drawer is open. */
  openMobileNav(): void {
    this.mobileNavOpen.set(true);
  }

  closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  openCommandPalette(): void {
    this.commandPaletteOpen.set(true);
  }

  closeCommandPalette(): void {
    this.commandPaletteOpen.set(false);
  }
}
