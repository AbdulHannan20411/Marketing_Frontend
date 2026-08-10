import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { IconComponent } from '@shared/ui/icon/icon.component';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Readonly<Record<ModalSize, string>> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Centred dialog with a scrim. Escape and scrim clicks both close it; the host
 * page owns the open state so the modal stays a pure presentational component.
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'fixed inset-0 z-100 grid place-items-center p-4 sm:p-6',
    '(document:keydown.escape)': 'dismiss()',
  },
  template: `
    <div
      class="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-fade"
      aria-hidden="true"
      (click)="dismiss()"
    ></div>

    <div
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="title()"
      class="relative flex max-h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line animate-rise"
      [class]="sizeClass()"
    >
      <header class="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div class="min-w-0">
          <h2 class="text-base font-semibold tracking-tight text-ink">{{ title() }}</h2>
          @if (subtitle() !== null) {
            <p class="mt-0.5 text-sm text-ink-muted">{{ subtitle() }}</p>
          }
        </div>
        <button
          type="button"
          class="-mr-1.5 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          aria-label="Close dialog"
          (click)="dismiss()"
        >
          <app-icon name="close" [size]="18" />
        </button>
      </header>

      <div class="app-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <ng-content />
      </div>

      <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">
        <ng-content select="[modalFooter]" />
      </footer>
    </div>
  `,
})
export class ModalComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly size = input<ModalSize>('md');

  readonly closed = output<void>();

  protected readonly sizeClass = computed(() => SIZE_CLASS[this.size()]);

  protected dismiss(): void {
    this.closed.emit();
  }
}
