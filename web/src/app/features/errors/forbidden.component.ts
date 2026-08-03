import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

@Component({
  selector: 'app-forbidden',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonDirective, IconComponent],
  template: `
    <div class="flex flex-col items-center justify-center py-24 text-center animate-rise">
      <div class="grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-warning">
        <app-icon name="lock" [size]="30" />
      </div>
      <h1 class="mt-5 text-xl font-semibold tracking-tight text-ink">You don't have access</h1>
      <p class="mt-2 max-w-md text-sm text-ink-muted">
        This area is restricted to a different role. Ask a workspace owner if you need permission.
      </p>
      <a appButton variant="outline" routerLink="/dashboard" class="mt-6">Back to dashboard</a>
    </div>
  `,
})
export class ForbiddenComponent {}
