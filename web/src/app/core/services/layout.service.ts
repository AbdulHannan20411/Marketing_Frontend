import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { NAVIGATION } from '@core/config/navigation.config';
import { UNLOCKED_ROUTES } from '@core/guards/subscription.guard';
import { SUPERADMIN_NAVIGATION } from '@core/config/superadmin-navigation.config';
import type { NavSection } from '@core/models/navigation.model';
import { EntitlementService } from './entitlement.service';

const COLLAPSE_KEY = 'vd.sidebar.collapsed';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly auth = inject(AuthService);
  private readonly entitlements = inject(EntitlementService);

  readonly sidebarCollapsed = signal(localStorage.getItem(COLLAPSE_KEY) === 'true');
  readonly mobileNavOpen = signal(false);
  readonly commandPaletteOpen = signal(false);

  /**
   * Navigation filtered to what the signed-in user may actually reach: they
   * need the permission *and* a plan that includes the module.
   *
   * Super Admins get their own portal's navigation instead — no permission or
   * plan filtering applies to them.
   */
  readonly visibleNavigation = computed<readonly NavSection[]>(() => {
    if (this.auth.isSuperAdmin()) {
      return SUPERADMIN_NAVIGATION;
    }

    return NAVIGATION.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          this.auth.hasAnyPermission(item.permissions) &&
          (item.roles === undefined || this.auth.hasRole(item.roles)) &&
          (item.module === undefined || this.entitlements.hasFeature(item.module)) &&
          // A locked workspace keeps only the routes that can unlock it —
          // otherwise the sidebar advertises screens that bounce straight back.
          this.isReachableWhileLocked(item.route),
      ),
    })).filter((section) => section.items.length > 0);
  });

  private isReachableWhileLocked(route: string): boolean {
    if (!this.entitlements.isLocked()) {
      return true;
    }
    const first = route.replace(/^\//, '').split('/')[0];
    return UNLOCKED_ROUTES.includes(first);
  }

  constructor() {
    effect(() => localStorage.setItem(COLLAPSE_KEY, String(this.sidebarCollapsed())));
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.update((open) => !open);
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
