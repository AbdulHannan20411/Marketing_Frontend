import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';

@Component({
  selector: 'app-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, IconComponent, SkeletonComponent],
  host: {
    class:
      'block rounded-xl bg-surface p-5 ring-1 ring-line shadow-card transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5',
  },
  template: `
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-medium tracking-wide text-ink-muted uppercase">{{ label() }}</p>

        @if (loading()) {
          <div class="mt-2.5"><app-skeleton width="6rem" height="1.75rem" /></div>
        } @else {
          <p class="mt-1.5 text-2xl font-semibold tracking-tight text-ink tabular-nums">
            {{ value() | number: format() }}{{ suffix() }}
          </p>
        }
      </div>

      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
        <app-icon [name]="icon()" [size]="20" />
      </span>
    </div>

    @if (!loading() && delta() !== null) {
      <div class="mt-3 flex items-center gap-1.5">
        <span
          class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold"
          [class]="deltaClass()"
        >
          {{ deltaPrefix() }}{{ absoluteDelta() | number: '1.1-1' }}%
        </span>
        <span class="text-xs text-ink-muted">vs previous 30 days</span>
      </div>
    }
  `,
})
export class StatCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly icon = input.required<IconName>();
  readonly delta = input<number | null>(null);
  readonly suffix = input('');
  readonly format = input('1.0-0');
  readonly loading = input(false);
  /** Set for metrics where a rise is bad (failures), so colour matches meaning. */
  readonly inverted = input(false);

  protected readonly absoluteDelta = computed(() => Math.abs(this.delta() ?? 0));
  protected readonly deltaPrefix = computed(() => ((this.delta() ?? 0) >= 0 ? '+' : '−'));

  protected readonly deltaClass = computed(() => {
    const rising = (this.delta() ?? 0) >= 0;
    const good = this.inverted() ? !rising : rising;
    return good ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700';
  });
}
