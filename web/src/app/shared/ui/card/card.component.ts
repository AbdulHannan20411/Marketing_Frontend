import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'classes()' },
  template: `
    @if (title() !== null) {
      <header class="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold text-ink">{{ title() }}</h2>
          @if (subtitle() !== null) {
            <p class="mt-0.5 truncate text-xs text-ink-muted">{{ subtitle() }}</p>
          }
        </div>
        <ng-content select="[cardActions]" />
      </header>
      <div class="h-px bg-line"></div>
    }
    <div [class]="bodyClass()">
      <ng-content />
    </div>
  `,
})
export class CardComponent {
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly interactive = input(false);
  readonly padded = input(true);

  protected readonly classes = computed(() =>
    [
      'block rounded-xl bg-white ring-1 ring-line shadow-card transition-all duration-200',
      this.interactive() ? 'hover:shadow-card-hover hover:-translate-y-0.5 hover:ring-brand-200' : '',
    ].join(' '),
  );

  protected readonly bodyClass = computed(() => (this.padded() ? 'p-5' : ''));
}
