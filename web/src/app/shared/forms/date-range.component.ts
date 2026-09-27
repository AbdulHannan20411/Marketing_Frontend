import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

import { ButtonDirective } from '@shared/ui/button/button.directive';
import { dateRangeError } from './validation';

let nextId = 0;

/**
 * A From/To date pair that cannot run backwards.
 *
 * Every range filter in the app was two independent date inputs, so picking a
 * From after a To was not only possible, it was quiet: the query went to the
 * API, described no period, and came back empty — which reads as "there is
 * nothing here" rather than "you have asked for nothing".
 *
 * Three layers, because one is not enough:
 *
 * 1. `max` on From and `min` on To, so the browser's own picker greys out the
 *    impossible days. This is the only one that prevents the mistake rather
 *    than reporting it.
 * 2. A message, for the paths the attributes do not cover — a typed date, a
 *    pasted one, and every browser that treats `min`/`max` as advisory.
 * 3. `invalid`, which the host reads before it loads, so a backwards range
 *    never becomes a request.
 */
@Component({
  selector: 'app-date-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonDirective],
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-1.5 text-xs text-ink-muted" [attr.for]="fromId">
        {{ fromLabel() }}
      </label>
      <input
        type="date"
        [attr.id]="fromId"
        [value]="from()"
        [attr.max]="to() || null"
        [attr.aria-invalid]="error() !== null"
        [attr.aria-describedby]="error() !== null ? errorId : null"
        class="h-8 rounded-lg border-0 bg-surface px-2 text-xs text-ink ring-1 ring-inset focus:ring-2 focus:outline-none"
        [class]="error() !== null ? 'ring-danger focus:ring-danger' : 'ring-line focus:ring-brand-500'"
        (change)="from.set($any($event.target).value)"
      />

      <label class="flex items-center gap-1.5 text-xs text-ink-muted" [attr.for]="toId">
        {{ toLabel() }}
      </label>
      <input
        type="date"
        [attr.id]="toId"
        [value]="to()"
        [attr.min]="from() || null"
        [attr.aria-invalid]="error() !== null"
        [attr.aria-describedby]="error() !== null ? errorId : null"
        class="h-8 rounded-lg border-0 bg-surface px-2 text-xs text-ink ring-1 ring-inset focus:ring-2 focus:outline-none"
        [class]="error() !== null ? 'ring-danger focus:ring-danger' : 'ring-line focus:ring-brand-500'"
        (change)="to.set($any($event.target).value)"
      />

      @if (from() !== '' || to() !== '') {
        <button appButton variant="ghost" size="sm" (click)="clear()">Clear dates</button>
      }
    </div>

    @if (error(); as message) {
      <p [attr.id]="errorId" role="alert" class="mt-1.5 text-xs font-medium text-danger">
        {{ message }}
      </p>
    }
  `,
})
export class DateRangeComponent {
  /** Both `YYYY-MM-DD`, or empty for an open end. Two-way bound. */
  readonly from = model('');
  readonly to = model('');

  readonly fromLabel = input('From');
  readonly toLabel = input('to');

  private readonly instance = nextId++;
  protected readonly fromId = `date-range-from-${this.instance}`;
  protected readonly toId = `date-range-to-${this.instance}`;
  protected readonly errorId = `date-range-error-${this.instance}`;

  protected readonly error = computed(() => dateRangeError(this.from(), this.to()));

  /** True while the range describes no period. The host checks this before loading. */
  readonly invalid = computed(() => this.error() !== null);

  protected clear(): void {
    this.from.set('');
    this.to.set('');
  }
}
