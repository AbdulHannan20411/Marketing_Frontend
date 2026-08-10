import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminScopeService } from '@core/scope/admin-scope.service';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

/**
 * Persistent banner shown while a Super Admin is viewing the platform as a
 * particular Admin. Makes the borrowed context unmistakable and offers a
 * one-click way back to the global view.
 */
@Component({
  selector: 'app-scope-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AvatarComponent, BadgeComponent, IconComponent],
  host: { class: 'block' },
  template: `
    @if (scope.selected(); as admin) {
      <div
        class="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:px-6"
        role="status"
      >
        <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warning text-white">
          <app-icon name="eye" [size]="15" />
        </span>

        <app-avatar [name]="admin.name" [initials]="admin.initials" size="sm" />

        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-amber-900">
            Viewing as {{ admin.name }}
            <span class="font-normal text-amber-800">· {{ admin.organisation }}</span>
          </p>
          <p class="text-xs text-amber-700">
            Changes you make here apply to this admin's workspace.
          </p>
        </div>

        <app-badge tone="warning" class="hidden sm:block">{{ admin.plan }}</app-badge>

        <div class="ml-auto flex items-center gap-2">
          <a
            routerLink="/superadmin/admins"
            class="rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
          >
            Switch admin
          </a>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300 transition-colors hover:bg-amber-100"
            (click)="exitScope()"
          >
            <app-icon name="close" [size]="13" />
            Exit
          </button>
        </div>
      </div>
    }
  `,
})
export class ScopeBarComponent {
  protected readonly scope = inject(AdminScopeService);
  private readonly router = inject(Router);

  /** Leaving scope returns to the global console rather than a scoped page. */
  protected exitScope(): void {
    this.scope.clear();
    void this.router.navigateByUrl('/superadmin/dashboard');
  }
}
