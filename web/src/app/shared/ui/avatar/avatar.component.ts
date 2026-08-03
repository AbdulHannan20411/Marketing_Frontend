import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type AvatarSize = 'sm' | 'md' | 'lg';

const SIZES: Record<AvatarSize, string> = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
};

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'classes()' },
  template: `
    @if (imageUrl() !== null) {
      <img [src]="imageUrl()" [alt]="name()" class="h-full w-full rounded-full object-cover" />
    } @else {
      <span aria-hidden="true">{{ initials() }}</span>
      <span class="sr-only">{{ name() }}</span>
    }
  `,
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly initials = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  readonly size = input<AvatarSize>('md');

  protected readonly classes = computed(
    () =>
      'inline-flex shrink-0 items-center justify-center rounded-full font-semibold ' +
      `bg-brand-100 text-brand-700 ring-2 ring-white ${SIZES[this.size()]}`,
  );
}
