import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import type { UsageView } from '@core/services/entitlement.service';

const SEVERITY_BAR: Readonly<Record<UsageView['severity'], string>> = {
  ok: 'bg-brand-500',
  warning: 'bg-amber-500',
  critical: 'bg-orange-500',
  exceeded: 'bg-red-500',
};

const SEVERITY_TEXT: Readonly<Record<UsageView['severity'], string>> = {
  ok: 'text-ink',
  warning: 'text-amber-700',
  critical: 'text-orange-700',
  exceeded: 'text-red-700',
};

/** Linear usage meter that colours itself by how close the metric is to its ceiling. */
@Component({
  selector: 'app-usage-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  host: { class: 'block' },
  template: `
    <div class="flex items-baseline justify-between gap-3">
      <p class="truncate text-sm font-medium text-ink-soft">{{ metric().label }}</p>
      <p class="shrink-0 text-xs font-semibold tabular-nums" [class]="textClass()">
        @if (metric().unlimited) {
          Unlimited
        } @else {
          {{ metric().percent }}%
        }
      </p>
    </div>

    <div
      class="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken"
      role="progressbar"
      [attr.aria-valuenow]="metric().percent"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-label]="metric().label"
    >
      <div
        class="h-full rounded-full transition-all duration-700 ease-out"
        [class]="barClass()"
        [style.width.%]="metric().unlimited ? 100 : metric().percent"
        [class.opacity-30]="metric().unlimited"
      ></div>
    </div>

    <p class="mt-1 text-xs text-ink-muted tabular-nums">
      {{ metric().used | number }}
      @if (metric().unlimited) {
        {{ metric().unit }} used · no limit
      } @else {
        of {{ metric().limit | number }} {{ metric().unit }}
        @if (metric().remaining !== null) {
          · {{ metric().remaining | number }} left
        }
      }
    </p>
  `,
})
export class UsageBarComponent {
  readonly metric = input.required<UsageView>();

  protected readonly barClass = computed(() => SEVERITY_BAR[this.metric().severity]);
  protected readonly textClass = computed(() => SEVERITY_TEXT[this.metric().severity]);
}
