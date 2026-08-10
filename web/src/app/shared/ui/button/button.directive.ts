import { Directive, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium rounded-lg whitespace-nowrap ' +
  'transition-all duration-150 ease-out select-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 ' +
    'hover:shadow-md hover:-translate-y-px active:translate-y-0 focus-visible:outline-brand-600',
  secondary:
    'bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200 focus-visible:outline-brand-600',
  outline:
    'bg-surface text-ink-soft ring-1 ring-line ring-inset shadow-xs ' +
    'hover:bg-surface-muted hover:text-ink hover:ring-brand-300 focus-visible:outline-brand-600',
  ghost: 'text-ink-soft hover:bg-surface-sunken hover:text-ink focus-visible:outline-brand-600',
  danger:
    'bg-danger text-white shadow-xs hover:bg-red-700 active:bg-red-800 ' +
    'hover:shadow-md hover:-translate-y-px active:translate-y-0 focus-visible:outline-danger',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9.5 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
  icon: 'h-9.5 w-9.5 p-0',
};

/**
 * Applied to a native `button` or `a` so semantics, focus handling and
 * routerLink keep working — the directive only supplies the visual layer.
 */
@Directive({
  selector: 'button[appButton], a[appButton]',
  host: { '[class]': 'classes()' },
})
export class ButtonDirective {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly block = input(false);

  protected readonly classes = computed(() =>
    [BASE, VARIANTS[this.variant()], SIZES[this.size()], this.block() ? 'w-full' : ''].join(' '),
  );
}
