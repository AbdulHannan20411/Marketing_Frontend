import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Shimmering placeholder block. Marked `aria-hidden` because the surrounding
 * region carries `aria-busy` — screen readers should hear "loading", not shapes.
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block animate-shimmer rounded-md bg-gray-200/70',
    '[style.width]': 'width()',
    '[style.height]': 'height()',
    'aria-hidden': 'true',
  },
  template: '',
})
export class SkeletonComponent {
  readonly width = input('100%');
  readonly height = input('1rem');
}
