import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ToastService, type ToastTone } from '@core/services/toast.service';
import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';

const TONE_ICON: Record<ToastTone, IconName> = {
  success: 'checkCircle',
  error: 'xCircle',
  warning: 'warning',
  info: 'info',
};

const TONE_ACCENT: Record<ToastTone, string> = {
  success: 'text-brand-600',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class:
      'pointer-events-none fixed bottom-4 right-4 z-100 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5',
    'aria-live': 'polite',
    'aria-atomic': 'false',
  },
  template: `
    @for (toast of toasts(); track toast.id) {
      <div
        class="pointer-events-auto flex items-start gap-3 rounded-xl bg-white p-3.5 ring-1 ring-line shadow-pop animate-rise"
      >
        <app-icon [name]="icon(toast.tone)" [class]="accent(toast.tone)" [size]="20" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-ink">{{ toast.title }}</p>
          @if (toast.description !== null) {
            <p class="mt-0.5 text-xs leading-relaxed text-ink-muted">{{ toast.description }}</p>
          }
        </div>
        <button
          type="button"
          class="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          [attr.aria-label]="'Dismiss ' + toast.title"
          (click)="toastService.dismiss(toast.id)"
        >
          <app-icon name="close" [size]="16" />
        </button>
      </div>
    }
  `,
})
export class ToastHostComponent {
  protected readonly toastService = inject(ToastService);
  protected readonly toasts = this.toastService.toasts;

  protected icon(tone: ToastTone): IconName {
    return TONE_ICON[tone];
  }

  protected accent(tone: ToastTone): string {
    return TONE_ACCENT[tone];
  }
}
