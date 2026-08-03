import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';

@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'flex flex-col items-center justify-center px-6 py-14 text-center animate-rise' },
  template: `
    <div class="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
      <app-icon [name]="icon()" [size]="26" />
    </div>
    <h3 class="mt-4 text-sm font-semibold text-ink">{{ title() }}</h3>
    <p class="mt-1.5 max-w-sm text-sm text-ink-muted">{{ description() }}</p>
    <div class="mt-5 flex flex-wrap items-center justify-center gap-2.5">
      <ng-content />
    </div>
  `,
})
export class EmptyStateComponent {
  readonly icon = input<IconName>('inbox');
  readonly title = input.required<string>();
  readonly description = input.required<string>();
}
