import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
  type OnDestroy,
} from '@angular/core';

import { IconComponent } from '@shared/ui/icon/icon.component';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Everything a keyboard can reach, in DOM order.
 *
 * `:not([disabled])` matters: a submit button disabled while saving must not
 * be a trap stop, or Tab lands on something that cannot be used.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * How many dialogs are open.
 *
 * Counted rather than set, because a dialog can open on top of another — a
 * confirmation over an editor. The page must not get its scrollbar back until
 * the last one closes.
 */
let openModals = 0;

const SIZE_CLASS: Readonly<Record<ModalSize, string>> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Centred dialog with a scrim. Escape and scrim clicks both close it; the host
 * page owns the open state so the modal stays a pure presentational component.
 *
 * **Its element is moved to `<body>` once rendered.** `position: fixed` is
 * positioned against the nearest ancestor with a transform, filter or
 * containment — and interactive cards lift on hover (`hover:-translate-y-0.5`).
 * A dialog opened from inside one was therefore confined to that card: narrow,
 * off-centre, and jumping every time the pointer crossed the card and the
 * transform toggled. Moving the element out makes the viewport its frame again,
 * wherever the markup happens to live.
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'fixed inset-0 z-100 grid place-items-center p-4 sm:p-6',
    '(document:keydown.escape)': 'dismiss()',
    '(keydown.tab)': 'trap($event)',
    '(keydown.shift.tab)': 'trap($event)',
  },
  template: `
    <div
      class="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-fade"
      aria-hidden="true"
      (click)="dismiss()"
    ></div>

    <div
      #dialog
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      [attr.aria-label]="title()"
      class="relative flex max-h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-line animate-rise focus:outline-none"
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
export class ModalComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  /** Whatever had focus before this opened, to give it back on close. */
  private readonly opener = document.activeElement as HTMLElement | null;

  constructor() {
    afterNextRender(() => {
      // After render, so the dialog exists before it is re-parented.
      document.body.appendChild(this.host.nativeElement);

      /*
       * Move focus into the dialog.
       *
       * Without this the keyboard stays wherever it was on the page behind —
       * so Tab walks the page under the scrim, Escape is the only way out,
       * and a screen reader never announces that a dialog opened at all.
       *
       * The dialog element itself, not its first control: the first focusable
       * is the close button, and landing there says nothing about what has
       * opened. Focusing the container announces the dialog and its label,
       * and the first Tab then reaches the close button anyway. This is what
       * `tabindex="-1"` on it is for.
       */
      this.dialog().nativeElement.focus({ preventScroll: true });

      // The page behind must not scroll under the scrim.
      openModals += 1;
      document.body.style.overflow = 'hidden';
    });
  }

  /**
   * Keeps Tab inside the dialog.
   *
   * A modal that lets the keyboard walk out onto the page behind it is modal
   * in appearance only: the user ends up typing into controls they cannot see,
   * with no way of knowing they have left.
   */
  protected trap(event: KeyboardEvent): void {
    const stops = [...this.dialog().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null,
    );
    if (stops.length === 0) {
      return;
    }

    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === this.dialog().nativeElement)) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * Takes the element with it.
   *
   * Angular removes a view's nodes through the parent it created them in, so
   * once this one has been moved it is nobody's child as far as the framework
   * is concerned — closing the dialog would leave a full-screen scrim over a
   * page that could no longer be clicked.
   */
  ngOnDestroy(): void {
    this.host.nativeElement.remove();

    // Only the last dialog to close gives the page its scrollbar back.
    openModals = Math.max(0, openModals - 1);
    if (openModals === 0) {
      document.body.style.overflow = '';
    }

    // Back where the user was. Without this, focus falls to the top of the
    // document and the next Tab starts from the beginning of the page.
    this.opener?.focus?.({ preventScroll: true });
  }

  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly size = input<ModalSize>('md');

  readonly closed = output<void>();

  protected readonly sizeClass = computed(() => SIZE_CLASS[this.size()]);

  protected dismiss(): void {
    this.closed.emit();
  }
}
