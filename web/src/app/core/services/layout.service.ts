import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { NAVIGATION } from '@core/config/navigation.config';
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
   */
  readonly visibleNavigation = computed<readonly NavSection[]>(() =>
    NAVIGATION.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          this.auth.hasAnyPermission(item.permissions) &&
          (item.roles === undefined || this.auth.hasRole(item.roles)) &&
          (item.module === undefined || this.entitlements.hasFeature(item.module)),
      ),
    })).filter((section) => section.items.length > 0),
  );

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
