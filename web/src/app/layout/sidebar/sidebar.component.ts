import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { LayoutService } from '@core/services/layout.service';
import { IconComponent } from '@shared/ui/icon/icon.component';

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './sidebar.component.html',
})
export class SidebarComponent {
  private readonly layout = inject(LayoutService);
  private readonly auth = inject(AuthService);

  /** Each portal has its own home, so the logo never bounces through a guard. */
  protected readonly homeRoute = computed(() =>
    this.auth.isSuperAdmin() ? '/superadmin/dashboard' : '/dashboard',
  );

  protected readonly appName = environment.appName;
  protected readonly sections = this.layout.visibleNavigation;
  protected readonly collapsed = this.layout.sidebarCollapsed;
  protected readonly mobileOpen = this.layout.mobileNavOpen;
  protected readonly widthClass = computed(() => (this.collapsed() ? 'w-[4.75rem]' : 'w-64'));

  protected toggle(): void {
    this.layout.toggleSidebar();
  }

  protected closeMobile(): void {
    this.layout.closeMobileNav();
  }
}
