import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import type { UsageView } from '@core/services/entitlement.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';

/**
 * The limit-reached / feature-locked state.
 *
 * Explains what was hit, shows current usage against the plan ceiling, and
 * offers the upgrade path — without blocking the rest of the page.
 */
@Component({
  selector: 'app-upgrade-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RouterLink, ButtonDirective, IconComponent],
  host: { class: 'block' },
  template: `
    <div
      class="relative overflow-hidden rounded-xl bg-gradient-to-br from-brand-50 to-emerald-50/60 p-6 text-center ring-1 ring-brand-200 sm:p-8"
    >
      <div
        class="absolute -top-20 -right-16 h-56 w-56 rounded-full bg-brand-200/30 blur-3xl"
        aria-hidden="true"
      ></div>

      <div class="relative mx-auto max-w-md">
        <span
          class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-surface text-brand-600 shadow-sm ring-1 ring-brand-200"
        >
          <app-icon [name]="icon()" [size]="26" />
        </span>

        <h3 class="mt-4 text-base font-semibold tracking-tight text-ink">{{ title() }}</h3>
        <p class="mt-2 text-sm leading-relaxed text-ink-soft">{{ description() }}</p>

        @if (metric(); as usage) {
          <div class="mt-5 rounded-xl bg-surface/80 p-4 ring-1 ring-brand-200/70 backdrop-blur-sm">
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-xs font-medium tracking-wide text-ink-muted uppercase">
                {{ usage.label }}
              </span>
              <span class="text-xs font-semibold text-ink tabular-nums">
                {{ usage.used | number }} / {{ usage.limit | number }} {{ usage.unit }}
              </span>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken">
              <div
                class="h-full rounded-full bg-red-500 transition-all duration-700"
                [style.width.%]="usage.percent"
              ></div>
            </div>
          </div>
        }

        @if (recommendedPlan() !== null) {
          <p class="mt-4 text-sm text-ink-soft">
            <span class="font-medium text-ink">{{ recommendedPlan() }}</span> lifts this limit.
          </p>
        }

        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <a appButton size="md" routerLink="/pricing">
            <app-icon name="rocket" [size]="16" />
            {{ ctaLabel() }}
          </a>
          <a appButton variant="ghost" size="md" routerLink="/subscription">View usage</a>
        </div>
      </div>
    </div>
  `,
})
export class UpgradePromptComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly metric = input<UsageView | null>(null);
  readonly recommendedPlan = input<string | null>(null);
  readonly ctaLabel = input('Upgrade plan');
  readonly iconName = input<IconName | null>(null);

  protected readonly icon = computed<IconName>(() => this.iconName() ?? 'rocket');
}
