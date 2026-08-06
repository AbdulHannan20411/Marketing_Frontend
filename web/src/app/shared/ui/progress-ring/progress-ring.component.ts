import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type RingTone = 'brand' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_STROKE: Readonly<Record<RingTone, string>> = {
  brand: 'stroke-brand-500',
  warning: 'stroke-amber-500',
  danger: 'stroke-red-500',
  info: 'stroke-emerald-500',
  neutral: 'stroke-slate-400',
};

/**
 * Circular usage indicator. The arc is drawn with a stroke-dasharray offset so
 * it animates smoothly and needs no JavaScript on redraw.
 */
@Component({
  selector: 'app-progress-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative inline-grid place-items-center' },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox()"
      class="-rotate-90"
      role="img"
      [attr.aria-label]="label()"
    >
      <circle
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        fill="none"
        [attr.stroke-width]="thickness()"
        class="stroke-slate-200/70"
      />
      <circle
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        fill="none"
        stroke-linecap="round"
        [attr.stroke-width]="thickness()"
        [attr.stroke-dasharray]="circumference()"
        [attr.stroke-dashoffset]="dashOffset()"
        class="transition-[stroke-dashoffset] duration-700 ease-out"
        [class]="strokeClass()"
      />
    </svg>

    <div class="absolute inset-0 grid place-items-center text-center">
      <ng-content />
    </div>
  `,
})
export class ProgressRingComponent {
  readonly value = input.required<number>();
  readonly size = input(96);
  readonly thickness = input(8);
  readonly tone = input<RingTone>('brand');
  readonly label = input('Usage');

  protected readonly center = computed(() => this.size() / 2);
  protected readonly radius = computed(() => this.center() - this.thickness() / 2);
  protected readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());

  protected readonly dashOffset = computed(() => {
    const clamped = Math.min(100, Math.max(0, this.value()));
    return this.circumference() * (1 - clamped / 100);
  });

  protected readonly strokeClass = computed(() => TONE_STROKE[this.tone()]);
}
