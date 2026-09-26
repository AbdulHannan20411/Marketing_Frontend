import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { EntitlementService } from '@core/services/entitlement.service';
import { LayoutService } from '@core/services/layout.service';
import { NotificationPreferencesService } from '@core/services/notification-preferences.service';
import { NotificationsService } from '@core/services/notifications.service';
import { OnboardingService } from '@core/services/onboarding.service';
import { RealtimeService } from '@core/services/realtime.service';
import { WhatsAppContextService } from '@core/services/whatsapp-context.service';
import { SessionHeartbeatService } from '@core/services/session-heartbeat.service';
import { AdminScopeService } from '@core/scope/admin-scope.service';
import { CommandPaletteComponent } from '@layout/command-palette/command-palette.component';
import { ScopeBarComponent } from '@layout/scope-bar/scope-bar.component';
import { ViewAsBarComponent } from '../view-as-bar/view-as-bar.component';
import { PlanGateDialogComponent } from '@shared/plan-gate/plan-gate-dialog.component';
import { SidebarComponent } from '@layout/sidebar/sidebar.component';
import { TopbarComponent } from '@layout/topbar/topbar.component';
import { ProductTourComponent } from '@shared/ui/product-tour/product-tour.component';

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ViewAsBarComponent,
    PlanGateDialogComponent,
    RouterOutlet,
    SidebarComponent,
    TopbarComponent,
    CommandPaletteComponent,
    ScopeBarComponent,
    ProductTourComponent,
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
      <app-view-as-bar />
      <app-plan-gate-dialog />
      <main id="main-content" tabindex="-1" class="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div class="mx-auto w-full max-w-[88rem]">
          <router-outlet />
        </div>
      </main>
    </div>

    <app-command-palette />
    <app-product-tour />
  `,
})
export class ShellComponent {
  private readonly layout = inject(LayoutService);
  private readonly entitlements = inject(EntitlementService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationsService);
  private readonly notificationPrefs = inject(NotificationPreferencesService);
  private readonly realtime = inject(RealtimeService);
  private readonly onboarding = inject(OnboardingService);
  private readonly whatsAppContext = inject(WhatsAppContextService);
  private readonly heartbeat = inject(SessionHeartbeatService);
  private readonly scope = inject(AdminScopeService);

  /** Sidebar is fixed-position, so the content column reserves its width on lg+. */
  protected readonly offset = computed(() =>
    this.layout.sidebarCollapsed() ? 'lg:pl-[4.75rem]' : 'lg:pl-64',
  );

  constructor() {
    // Entitlements gate the sidebar and route guards, so they load once here
    // rather than per-page.
    this.entitlements.load();
    // Before the list, so a silenced category is never briefly shown.
    this.notificationPrefs.load();
    this.notifications.load();

    /*
     * There is deliberately no redirect for a workspace with no plan.
     *
     * This used to send a locked workspace to `/subscription` and keep it
     * there. That was the earlier product direction, and it was wrong: being
     * dropped on a pricing page with the rest of the product sealed off gives
     * somebody no idea what they would be buying. Every screen now opens and
     * reads normally, and the offer arrives on the write — see
     * `PlanGateService`. The API refuses those writes regardless, so nothing
     * here is load-bearing for security.
     */

    /*
     * Offer the product tour once, on a first login.
     *
     * Waits for entitlements because the sidebar — and therefore the tour's
     * steps — depends on which plan modules are on. Starting before they load
     * would build a tour from a half-populated sidebar and get the step count
     * wrong. Runs after a paint so the sidebar has actually rendered.
     */
    effect(() => {
      const user = this.auth.user();
      const ready = this.entitlements.isLoaded();

      if (user === null || !ready) {
        return;
      }

      untracked(() => setTimeout(() => this.onboarding.maybeStartForFirstLogin(), 0));
    });

    /*
     * Load the WhatsApp numbers this user may see, once the plan is known.
     *
     * Re-runs when a Super Admin changes which admin they are viewing: the
     * numbers belong to that admin's workspace, and the previous one's list
     * must not linger. Unscoped Super Admins have no workspace, so nothing loads.
     */
    effect(() => {
      const user = this.auth.user();
      const ready = this.entitlements.isLoaded();
      const scopeId = this.scope.selectedId();
      /*
       * Also when a preview starts or ends.
       *
       * Under a data preview the API answers reads as the teammate, and the
       * numbers they may use are rarely the numbers the admin may use. Without
       * this the picker would keep showing the admin's, which is the one place
       * a stale cache would quietly contradict the banner.
       */
      this.auth.viewingAs();

      untracked(() => {
        const inWorkspace = !this.auth.isSuperAdmin() || scopeId !== null;
        if (user === null || !ready || !inWorkspace || !this.entitlements.hasFeature('whatsapp')) {
          this.whatsAppContext.clear();
          return;
        }
        this.whatsAppContext.load();
      });
    });

    // The bell is tenant-scoped too, so a preview changes whose notifications
    // it holds. Reloaded on the way in and on the way out.
    effect(() => {
      this.auth.viewingAs();
      untracked(() => this.notifications.load());
    });

    // Campaign progress and notifications arrive by push; the reports endpoints
    // are rate limited to 4 per window, so polling is not an option.
    this.realtime.connect();
    // Keeps this device marked active, and is how a session ended elsewhere is
    // noticed within a minute even on a screen that makes no other requests.
    this.heartbeat.start();
    inject(DestroyRef).onDestroy(() => {
      this.realtime.disconnect();
      this.heartbeat.stop();
    });
  }
}
