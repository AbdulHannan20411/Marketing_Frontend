import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Keeps a numeric input non-negative and, by default, whole.
 *
 * `type="number"` with `min="0"` looks like validation but is not: the browser
 * only stops the spinner and marks the field `:invalid`. Typing or pasting
 * `-5` still reaches the model, and the form submits it. Nothing downstream —
 * a plan's contact ceiling, a price, a trial length — has a meaningful negative
 * value, so this refuses one at the source.
 *
 * Three layers, because each catches what the others miss:
 *  - keystrokes: `-`, `+` and `e` never make it in
 *  - paste: sanitised before it lands
 *  - input: a final clamp, covering the spinner and anything scripted
 *
 * The control is written to through `NgControl` when one is present, so both
 * template-driven and reactive forms stay in step with the DOM.
 */
@Directive({
  selector: 'input[appPositiveNumber]',
  host: { inputmode: 'numeric' },
})
export class PositiveNumberDirective {
  /** Smallest value allowed. Use `1` for counts that cannot be zero. */
  readonly min = input(0, { alias: 'appPositiveNumberMin' });
  readonly max = input<number | null>(null, { alias: 'appPositiveNumberMax' });
  /** Set false for money or percentages that may carry decimals. */
  readonly integer = input(true, { alias: 'appPositiveNumberInteger' });

  private readonly host = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly control = inject(NgControl, { optional: true, self: true });

  /** Blocked outright: a minus makes it negative, `e` makes it exponential. */
  private static readonly BLOCKED_KEYS = ['-', '+', 'e', 'E'];

  @HostListener('keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (PositiveNumberDirective.BLOCKED_KEYS.includes(event.key)) {
      event.preventDefault();
      return;
    }
    // A decimal point only makes sense when decimals are allowed.
    if (this.integer() && (event.key === '.' || event.key === ',')) {
      event.preventDefault();
    }
  }

  @HostListener('paste', ['$event'])
  protected onPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    const cleaned = this.sanitise(pasted);

    event.preventDefault();
    if (cleaned !== '') {
      this.write(cleaned);
    }
  }

  /** Last line of defence: the spinner, autofill, or anything set in code. */
  @HostListener('input')
  protected onInput(): void {
    const raw = this.host.nativeElement.value;
    if (raw === '') {
      return;
    }

    const cleaned = this.sanitise(raw);
    if (cleaned !== raw) {
      this.write(cleaned);
    }
  }

  /** Empty is left empty on blur rather than forced to zero — see `write`. */
  @HostListener('blur')
  protected onBlur(): void {
    const raw = this.host.nativeElement.value;
    if (raw === '') {
      return;
    }
    const clamped = this.clamp(Number(raw));
    if (String(clamped) !== raw) {
      this.write(String(clamped));
    }
  }

  private sanitise(value: string): string {
    const stripped = this.integer()
      ? value.replace(/[^\d]/g, '')
      : value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

    if (stripped === '' || stripped === '.') {
      return '';
    }
    return String(this.clamp(Number(stripped)));
  }

  private clamp(value: number): number {
    if (Number.isNaN(value)) {
      return this.min();
    }
    const upper = this.max();
    const lowerBounded = Math.max(this.min(), value);
    return upper === null ? lowerBounded : Math.min(upper, lowerBounded);
  }

  /**
   * Writes to the DOM *and* the bound control.
   *
   * Setting `nativeElement.value` alone leaves the model holding the rejected
   * value — the field would show `5` while the form still submitted `-5`.
   */
  private write(value: string): void {
    this.host.nativeElement.value = value;
    this.control?.control?.setValue(value === '' ? null : Number(value), { emitEvent: true });
  }
}
