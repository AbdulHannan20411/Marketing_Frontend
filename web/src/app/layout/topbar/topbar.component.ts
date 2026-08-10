import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { USER_ROLE_LABEL } from '@core/models/auth.model';
import type { AppNotification } from '@core/models/notification.model';
import { EntitlementService } from '@core/services/entitlement.service';
import { LayoutService } from '@core/services/layout.service';
import { NotificationsService } from '@core/services/notifications.service';
import { ThemeService } from '@core/services/theme.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

export const NOTIFICATION_TONE: Readonly<Record<AppNotification['priority'], BadgeTone>> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
  success: 'success',
};

@Component({
  selector: 'app-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TimeAgoPipe, IconComponent, AvatarComponent, BadgeComponent],
  templateUrl: './topbar.component.html',
  host: {
    class:
      'sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md sm:px-6',
    '(document:keydown.escape)': 'closeMenus()',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class TopbarComponent {
  private readonly auth = inject(AuthService);
  private readonly layout = inject(LayoutService);
  private readonly notificationsService = inject(NotificationsService);
  private readonly entitlements = inject(EntitlementService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  protected readonly isDark = this.theme.isDark;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly user = this.auth.user;
  protected readonly profileOpen = signal(false);
  protected readonly notificationsOpen = signal(false);

  protected readonly roleLabel = USER_ROLE_LABEL;
  protected readonly priorityTone = NOTIFICATION_TONE;

  protected readonly unreadCount = this.notificationsService.unreadCount;
  protected readonly hasCritical = this.notificationsService.hasCritical;

  /** Newest first, capped — the full list lives on the notifications page. */
  protected readonly recent = computed(() =>
    [...this.notificationsService.notifications()]
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .slice(0, 5),
  );

  protected readonly daysRemaining = this.entitlements.daysRemaining;
  protected readonly planName = computed(() => this.entitlements.plan()?.name ?? null);

  /**
   * Subscription and billing belong to a tenant, so they are hidden from
   * platform staff — a Super Admin has no plan of their own to manage.
   */
  protected readonly showBillingLinks = computed(() => !this.auth.isSuperAdmin());

  protected readonly showRenewalWarning = computed(
    () => this.showBillingLinks() && this.entitlements.isExpiringSoon(),
  );

  protected openSearch(): void {
    this.closeMenus();
    this.layout.openCommandPalette();
  }

  /** Quick flip; the three-way preference lives in Settings. */
  protected toggleTheme(): void {
    this.theme.toggle();
  }

  protected toggleMobileNav(): void {
    this.layout.toggleMobileNav();
  }

  protected toggleProfile(): void {
    this.notificationsOpen.set(false);
    this.profileOpen.update((open) => !open);
  }

  protected toggleNotifications(): void {
    this.profileOpen.set(false);
    this.notificationsOpen.update((open) => !open);
  }

  protected openNotification(notification: AppNotification): void {
    this.notificationsService.markRead(notification.id);
    this.closeMenus();
    if (notification.actionRoute !== null) {
      void this.router.navigateByUrl(notification.actionRoute);
    }
  }

  protected markAllRead(): void {
    this.notificationsService.markAllRead();
  }

  protected closeMenus(): void {
    this.profileOpen.set(false);
    this.notificationsOpen.set(false);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.closeMenus();
    }
  }

  protected logout(): void {
    this.closeMenus();
    this.auth.logout();
  }
}
