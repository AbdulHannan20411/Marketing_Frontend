import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * Accessible switch. Uses `model()` so callers can two-way bind with
 * `[(checked)]` or listen to `(checkedChange)`.
 */
@Component({
  selector: 'app-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label()"
      [disabled]="disabled()"
      (click)="toggle()"
      class="relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      [class]="checked() ? 'bg-brand-600' : 'bg-slate-300'"
    >
      <span
        class="pointer-events-none absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full bg-surface shadow-sm transition-transform duration-200 ease-out"
        [class]="checked() ? 'translate-x-4.5' : 'translate-x-0'"
      ></span>
    </button>
  `,
})
export class ToggleComponent {
  readonly checked = model.required<boolean>();
  readonly disabled = input(false);
  readonly label = input('Toggle');

  protected toggle(): void {
    if (!this.disabled()) {
      this.checked.update((value) => !value);
    }
  }
}
