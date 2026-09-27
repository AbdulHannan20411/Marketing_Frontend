import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

let nextId = 0;

/**
 * The label, the asterisk, the hint, the counter and the error, once.
 *
 * Every form in the app was assembling these by hand, which is why the same
 * field was required-with-an-asterisk on one screen and required-silently on
 * the next, and why a limit was only discoverable by typing until the API
 * refused. Wrapping the control instead of replacing it keeps each form's own
 * input — a `<select>`, a phone field with a preview, a toggle — and still puts
 * the same furniture around all of them.
 *
 * ```html
 * <app-field label="Name" [required]="true" [max]="120" [value]="name()" [error]="nameError()">
 *   <input [value]="name()" (input)="name.set($any($event.target).value)" [maxlength]="120" />
 * </app-field>
 * ```
 *
 * The control is wired up by `for`/`id`, so pass the same `controlId` to both.
 */
@Component({
  selector: 'app-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex items-baseline justify-between gap-2">
      <label [attr.for]="controlId()" class="block text-sm font-medium text-ink">
        {{ label() }}
        @if (required()) {
          <!-- The asterisk is not the only signal: it is also in the accessible
               name, because a red glyph is invisible to a screen reader and to
               anyone who does not know the convention. -->
          <span class="text-danger" aria-hidden="true">*</span>
          <span class="sr-only">(required)</span>
        }
      </label>

      @if (counter(); as text) {
        <span
          class="text-[11px] tabular-nums"
          [class]="overLimit() ? 'font-medium text-danger' : 'text-ink-muted'"
        >
          {{ text }}
        </span>
      }
    </div>

    <div class="mt-1.5">
      <ng-content />
    </div>

    @if (error(); as message) {
      <!-- `alert` rather than plain text: the message often appears after a
           failed submit, when focus is on the button and nothing would
           otherwise be announced. -->
      <p [attr.id]="errorId" role="alert" class="mt-1.5 text-xs font-medium text-danger">
        {{ message }}
      </p>
    } @else if (hint()) {
      <p [attr.id]="hintId" class="mt-1.5 text-xs text-ink-muted">{{ hint() }}</p>
    }
  `,
})
export class FieldComponent {
  readonly label = input.required<string>();
  /** The `id` of the control inside, so the label points at it. */
  readonly controlId = input.required<string>();
  readonly required = input(false);
  /** Shown under the field until there is an error to show instead. */
  readonly hint = input('');
  /** The current message, or empty for none. */
  readonly error = input('');

  /**
   * The field's character limit. Drives the counter only.
   *
   * The `maxlength` attribute still belongs on the control: it is what stops
   * the typing, and this component cannot reach inside projected content to
   * add it.
   */
  readonly max = input<number | null>(null);
  /** The current value, for the counter. */
  readonly value = input('');

  private readonly instance = nextId++;
  protected readonly errorId = `field-error-${this.instance}`;
  protected readonly hintId = `field-hint-${this.instance}`;

  protected readonly overLimit = computed(() => {
    const max = this.max();
    return max !== null && this.value().length > max;
  });

  /**
   * "64 / 120", but only once it is worth knowing.
   *
   * A counter from the first keystroke reads as a demand rather than a help,
   * so it appears at three-quarters of the limit — the point where somebody
   * writing might actually need to plan the rest of the sentence.
   */
  protected readonly counter = computed(() => {
    const max = this.max();
    if (max === null) {
      return null;
    }
    const length = this.value().length;
    return length >= max * 0.75 ? `${length} / ${max}` : null;
  });
}
