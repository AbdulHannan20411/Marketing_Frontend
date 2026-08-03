import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { Breadcrumb } from '@core/models/navigation.model';
import { NAVIGATION } from '@core/config/navigation.config';
import { CardComponent } from '@shared/ui/card/card.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { Router } from '@angular/router';
import type { IconName } from '@shared/ui/icon/icon.registry';

/**
 * Stands in for modules that have not been implemented yet, so the shell,
 * guards and navigation can be exercised end to end from day one.
 */
@Component({
  selector: 'app-placeholder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, CardComponent, EmptyStateComponent],
  template: `
    <app-page-header [title]="title()" [description]="description()" [breadcrumbs]="crumbs()" />
    <app-card class="mt-6" [padded]="false">
      <app-empty-state
        [icon]="icon()"
        [title]="title() + ' is next in the build queue'"
        description="The shell, routing, guards and design system are in place — this module will render here."
      />
    </app-card>
  `,
})
export class PlaceholderComponent {
  private readonly router = inject(Router);

  readonly title = input.required<string>();
  readonly description = input<string | null>(null);

  protected readonly icon = computed<IconName>(() => {
    const url = this.router.url;
    const match = NAVIGATION.flatMap((section) => section.items).find((item) =>
      url.startsWith(item.route),
    );
    return match?.icon ?? 'grid';
  });

  protected readonly crumbs = computed<readonly Breadcrumb[]>(() => [
    { label: 'Home', route: '/dashboard' },
    { label: this.title(), route: null },
  ]);
}
