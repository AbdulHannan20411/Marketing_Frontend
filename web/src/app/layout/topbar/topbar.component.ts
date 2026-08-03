import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { LayoutService } from '@core/services/layout.service';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

@Component({
  selector: 'app-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, AvatarComponent, BadgeComponent],
  templateUrl: './topbar.component.html',
  host: {
    class:
      'sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/85 px-4 backdrop-blur-md sm:px-6',
    '(document:keydown.escape)': 'closeMenus()',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class TopbarComponent {
  private readonly auth = inject(AuthService);
  private readonly layout = inject(LayoutService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly user = this.auth.user;
  protected readonly profileOpen = signal(false);
  protected readonly notificationsOpen = signal(false);

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
