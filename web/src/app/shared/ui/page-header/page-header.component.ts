import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { Breadcrumb } from '@core/models/navigation.model';
import { IconComponent } from '@shared/ui/icon/icon.component';

@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  host: { class: 'block' },
  template: `
    @if (breadcrumbs().length > 0) {
      <nav aria-label="Breadcrumb" class="mb-2">
        <ol class="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
          @for (crumb of breadcrumbs(); track crumb.label; let last = $last) {
            <li class="flex items-center gap-1">
              @if (crumb.route !== null && !last) {
                <a
                  [routerLink]="crumb.route"
                  class="rounded transition-colors hover:text-brand-700"
                  >{{ crumb.label }}</a
                >
              } @else {
                <span [attr.aria-current]="last ? 'page' : null" class="text-ink-soft">{{
                  crumb.label
                }}</span>
              }
              @if (!last) {
                <app-icon name="chevronRight" [size]="12" class="text-line-strong" />
              }
            </li>
          }
        </ol>
      </nav>
    }

    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{{ title() }}</h1>
        @if (description() !== null) {
          <p class="mt-1 max-w-2xl text-sm text-ink-muted">{{ description() }}</p>
        }
      </div>
      <div class="flex flex-wrap items-center gap-2.5">
        <ng-content />
      </div>
    </div>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  readonly breadcrumbs = input<readonly Breadcrumb[]>([]);
}
