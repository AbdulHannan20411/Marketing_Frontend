import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

/**
 * Shown while an admin is viewing the app as one of their team.
 *
 * Deliberately blunt about which of the two previews is running, because the
 * difference matters to the person reading the screen:
 *
 * - With `capabilities.viewAsEmployee`, every read is answered as that
 *   teammate — their numbers, their assigned conversations — and every write
 *   is refused. Read-only is literal here, not a convention.
 * - Without it, only the menu and the permission gates narrow and the records
 *   are still the admin's own. Nobody should believe they are looking at
 *   somebody else's inbox when they are looking at their own through a
 *   narrower menu.
 *
 * Always visible while previewing, and it is what gets you back: previewing a
 * teammate who cannot open Employees would otherwise hide the way out.
 */
@Component({
  selector: 'app-view-as-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent, BadgeComponent, ButtonDirective, IconComponent],
  host: { class: 'block' },
  template: `
    @if (auth.viewingAs(); as subject) {
      <div
        class="flex flex-wrap items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2.5 sm:px-6"
        role="status"
      >
        <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
          <app-icon name="eye" [size]="15" />
        </span>

        <app-avatar [name]="subject.name" [initials]="subject.initials" size="sm" />

        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-brand-900">
            Viewing the app as {{ subject.name }}
            @if (subject.jobTitle !== '') {
              <span class="font-normal text-brand-800">· {{ subject.jobTitle }}</span>
            }
          </p>
          <p class="text-xs text-brand-900/70">
            {{
              auth.isViewingData()
                ? 'Their records, their numbers, their menu — read-only. Leave the preview to make changes.'
                : 'Their menu and permissions. The records are still yours — anything you do here is recorded as you.'
            }}
          </p>
        </div>

        <app-badge tone="brand" class="hidden sm:block">{{ subject.role }}</app-badge>
        @if (auth.isViewingData()) {
          <app-badge tone="neutral" class="hidden sm:block">Read-only</app-badge>
        }

        <button appButton variant="outline" size="sm" class="ml-auto" (click)="stop()">
          <app-icon name="close" [size]="14" />
          Back to my view
        </button>
      </div>
    }
  `,
})
export class ViewAsBarComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected stop(): void {
    this.auth.stopViewingAs();
    // Back to where the admin can act, since the preview may have redirected
    // them off a page their teammate could not open.
    void this.router.navigate(['/employees']);
  }
}
