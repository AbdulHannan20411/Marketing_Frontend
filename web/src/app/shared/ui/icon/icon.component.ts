import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ICON_PATHS, type IconName } from './icon.registry';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      [attr.stroke-width]="strokeWidth()"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.aria-hidden]="label() === null ? 'true' : null"
      [attr.role]="label() === null ? null : 'img'"
      [attr.aria-label]="label()"
    >
      @for (path of paths(); track path) {
        <path [attr.d]="path" />
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly strokeWidth = input(1.6);
  /** Provide only for icons that carry meaning on their own; decorative icons stay unlabelled. */
  readonly label = input<string | null>(null);

  protected readonly paths = computed<readonly string[]>(() => ICON_PATHS[this.name()]);
}
