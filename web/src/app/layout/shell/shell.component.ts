import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { UNLOCKED_ROUTES } from '@core/guards/subscription.guard';
import { EntitlementService } from '@core/services/entitlement.service';
import { LayoutService } from '@core/services/layout.service';
import { NotificationsService } from '@core/services/notifications.service';
import { RealtimeService } from '@core/services/realtime.service';
import { CommandPaletteComponent } from '@layout/command-palette/command-palette.component';
import { ScopeBarComponent } from '@layout/scope-bar/scope-bar.component';
import { SidebarComponent } from '@layout/sidebar/sidebar.component';
import { TopbarComponent } from '@layout/topbar/topbar.component';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopbarComponent,
    CommandPaletteComponent,
    ScopeBarComponent,
  ],
  host: { class: 'block min-h-dvh bg-surface-muted' },
  template: `
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
    >
      Skip to content
    </a>

    <app-sidebar />

    <div class="flex min-h-dvh flex-col transition-[padding] duration-300 ease-out" [class]="offset()">
      <app-topbar />
      <app-scope-bar />
      <main id="main-content" tabindex="-1" class="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div class="mx-auto w-full max-w-[88rem]">
          <router-outlet />
        </div>
      </main>
    </div>

    <app-command-palette />
  `,
})
export class ShellComponent {
  private readonly layout = inject(LayoutService);
  private readonly entitlements = inject(EntitlementService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationsService);
  private readonly realtime = inject(RealtimeService);

  /** Sidebar is fixed-position, so the content column reserves its width on lg+. */
  protected readonly offset = computed(() =>
    this.layout.sidebarCollapsed() ? 'lg:pl-[4.75rem]' : 'lg:pl-64',
  );

  constructor() {
    // Entitlements gate the sidebar and route guards, so they load once here
    // rather than per-page.
    this.entitlements.load();
    this.notifications.load();

    /*
     * Enforce the lock once the subscription is actually known.
     *
     * `subscriptionLockGuard` runs before this load resolves, so on a fresh
     * sign-in it sees no subscription and lets the user through to wherever
     * they were heading. Guards do not re-run on their own, so the redirect has
     * to happen here — and this also covers a workspace that is suspended
     * mid-session, which no guard would ever catch.
     */
    effect(() => {
      if (this.auth.isSuperAdmin() || !this.entitlements.isLocked()) {
        return;
      }

      const first = this.router.url.split('?')[0].replace(/^\//, '').split('/')[0];
      if (!UNLOCKED_ROUTES.includes(first)) {
        void this.router.navigate(['/subscription']);
      }
    });

    // Campaign progress and notifications arrive by push; the reports endpoints
    // are rate limited to 4 per window, so polling is not an option.
    this.realtime.connect();
    inject(DestroyRef).onDestroy(() => this.realtime.disconnect());
  }
}
