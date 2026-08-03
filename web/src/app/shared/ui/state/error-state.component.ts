import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

@Component({
  selector: 'app-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ButtonDirective],
  host: {
    class: 'flex flex-col items-center justify-center px-6 py-14 text-center animate-rise',
    role: 'alert',
  },
  template: `
    <div class="grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-danger">
      <app-icon name="warning" [size]="26" />
    </div>
    <h3 class="mt-4 text-sm font-semibold text-ink">{{ title() }}</h3>
    <p class="mt-1.5 max-w-sm text-sm text-ink-muted">{{ description() }}</p>
    <button appButton variant="outline" size="sm" class="mt-5" (click)="retry.emit()">
      <app-icon name="refresh" [size]="16" />
      Try again
    </button>
  `,
})
export class ErrorStateComponent {
  readonly title = input('Something went wrong');
  readonly description = input('We could not load this content. Please try again in a moment.');
  readonly retry = output<void>();
}
