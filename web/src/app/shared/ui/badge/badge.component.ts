import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-ink-soft ring-gray-200',
  success: 'bg-green-50 text-green-700 ring-green-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
};

const DOTS: Record<BadgeTone, string> = {
  neutral: 'bg-gray-400',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-emerald-500',
  brand: 'bg-brand-500',
};

@Component({
  selector: 'app-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'classes()' },
  template: `
    @if (dot()) {
      <span class="h-1.5 w-1.5 rounded-full" [class]="dotClass()" aria-hidden="true"></span>
    }
    <ng-content />
  `,
})
export class BadgeComponent {
  readonly tone = input<BadgeTone>('neutral');
  readonly dot = input(false);

  protected readonly classes = computed(
    () =>
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ' +
      `ring-1 ring-inset ${TONES[this.tone()]}`,
  );

  protected readonly dotClass = computed(() => DOTS[this.tone()]);
}
