import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, viewChild, type ElementRef } from '@angular/core';

import { OnboardingService } from '@core/services/onboarding.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/** Gap between the spotlight and the tooltip. */
const TOOLTIP_GAP = 14;
/** Breathing room around the highlighted element. */
const SPOTLIGHT_PAD = 6;
/** Keep the tooltip this far from every viewport edge. */
const VIEWPORT_MARGIN = 12;

interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

type Placement = 'right' | 'left' | 'top' | 'bottom';

/**
 * The product tour's chrome: dim, spotlight, tooltip, progress and controls.
 *
 * Rendered once by the shell and driven entirely by `OnboardingService` — it
 * decides *what* the tour is doing, this decides how it looks.
 *
 * The dim is the spotlight's own `box-shadow`, spread wide enough to cover any
 * viewport. That gives a real hole rather than a lighter patch, needs no SVG
 * mask, and leaves the highlighted element rendering normally underneath rather
 * than being cloned into the overlay — so it cannot drift out of sync with the
 * thing it is pointing at.
 */
@Component({
  selector: 'app-product-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Listened for on the document, not the tooltip: clicking the dimmed area
  // moves focus to the body, and Escape has to keep working after that.
  host: { '(document:keydown)': 'onKeydown($event)' },
  imports: [ButtonDirective, IconComponent, ModalComponent],
  templateUrl: './product-tour.component.html',
})
export class ProductTourComponent {
  private readonly tour = inject(OnboardingService);

  private readonly tooltip = viewChild<ElementRef<HTMLElement>>('tooltip');

  protected readonly active = this.tour.active;
  protected readonly settling = this.tour.settling;
  protected readonly confirmingSkip = this.tour.confirmingSkip;
  protected readonly step = this.tour.currentStep;
  protected readonly total = this.tour.total;
  protected readonly isFirst = this.tour.isFirst;
  protected readonly isLast = this.tour.isLast;

  /** 1-based, for "Step 3 of 8". */
  protected readonly stepNumber = computed(() => this.tour.stepIndex() + 1);

  /** Dots for the progress indicator. */
  protected readonly dots = computed(() => Array.from({ length: this.total() }, (_, i) => i));

  protected readonly percent = computed(() =>
    this.total() === 0 ? 0 : Math.round((this.stepNumber() / this.total()) * 100),
  );

  /** The highlighted element's box, in viewport coordinates. Null while settling. */
  protected readonly targetRect = signal<Rect | null>(null);
  protected readonly placement = signal<Placement>('right');
  protected readonly tooltipPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });

  /**
   * Both the spotlight and the tooltip are placed with `translate3d` from a
   * `top:0; left:0` anchor rather than by setting `top`/`left`.
   *
   * Moving a fixed element by transform is composited rather than laid out, so
   * a step change repaints without invalidating layout — which is what keeps
   * the tour from nudging the page underneath it.
   */
  protected readonly spotlightStyle = computed(() => {
    const rect = this.targetRect();
    if (rect === null) {
      return null;
    }
    return {
      transform: `translate3d(${rect.left - SPOTLIGHT_PAD}px, ${rect.top - SPOTLIGHT_PAD}px, 0)`,
      width: `${rect.width + SPOTLIGHT_PAD * 2}px`,
      height: `${rect.height + SPOTLIGHT_PAD * 2}px`,
    };
  });

  protected readonly tooltipTransform = computed(() => {
    const { top, left } = this.tooltipPosition();
    return `translate3d(${left}px, ${top}px, 0)`;
  });

  private frame = 0;

  constructor() {
    // Reposition whenever the step changes or the tour starts.
    effect(() => {
      const selector = this.tour.currentSelector();
      const running = this.active();
      const settling = this.settling();

      untracked(() => {
        if (!running || settling || selector === null) {
          return;
        }
        this.reposition(selector);
        this.focusTooltip();
      });
    });

    // The viewport moving under a fixed-position spotlight is the one thing
    // that would leave it pointing at empty space.
    const recompute = (): void => {
      if (!this.active()) {
        return;
      }
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        const selector = this.tour.currentSelector();
        if (selector !== null) {
          this.reposition(selector, false);
        }
      });
    };

    window.addEventListener('resize', recompute, { passive: true });
    window.addEventListener('scroll', recompute, { passive: true, capture: true });
  }

  /* ---------------------------- positioning ---------------------------- */

  private reposition(selector: string, scrollIntoView = true): void {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) {
      this.targetRect.set(null);
      return;
    }

    if (scrollIntoView && !this.isFullyVisible(element)) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // Re-measure once the scroll has settled; the first measurement would be
      // of where the element was, not where it is going.
      setTimeout(() => this.measure(element), 320);
      return;
    }

    this.measure(element);
  }

  private isFullyVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  }

  private measure(element: HTMLElement): void {
    const box = element.getBoundingClientRect();
    const rect: Rect = { top: box.top, left: box.left, width: box.width, height: box.height };
    this.targetRect.set(rect);
    this.placeTooltip(rect);
  }

  /**
   * Chooses a side with room for the tooltip, then clamps it into the viewport.
   *
   * Right first, because every target is a sidebar item and the content sits to
   * its right. On a narrow screen nothing fits beside it, so it drops below —
   * and if that would overflow too, it is clamped rather than allowed off
   * screen, which is the failure the brief calls out.
   */
  private placeTooltip(rect: Rect): void {
    const width = this.tooltipWidth();
    const height = this.tooltipHeight();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const fitsRight = rect.left + rect.width + TOOLTIP_GAP + width + VIEWPORT_MARGIN <= viewportWidth;
    const fitsLeft = rect.left - TOOLTIP_GAP - width - VIEWPORT_MARGIN >= 0;
    const fitsBelow = rect.top + rect.height + TOOLTIP_GAP + height + VIEWPORT_MARGIN <= viewportHeight;

    const placement: Placement = fitsRight ? 'right' : fitsLeft ? 'left' : fitsBelow ? 'bottom' : 'top';
    this.placement.set(placement);

    let top: number;
    let left: number;

    switch (placement) {
      case 'right':
        top = rect.top + rect.height / 2 - height / 2;
        left = rect.left + rect.width + TOOLTIP_GAP;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - height / 2;
        left = rect.left - TOOLTIP_GAP - width;
        break;
      case 'bottom':
        top = rect.top + rect.height + TOOLTIP_GAP;
        left = rect.left + rect.width / 2 - width / 2;
        break;
      default:
        top = rect.top - TOOLTIP_GAP - height;
        left = rect.left + rect.width / 2 - width / 2;
    }

    this.tooltipPosition.set({
      top: this.clamp(top, VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN),
      left: this.clamp(left, VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
    });
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, Math.max(min, max)));
  }

  private tooltipWidth(): number {
    const measured = this.tooltip()?.nativeElement.offsetWidth ?? 0;
    return measured > 0 ? measured : Math.min(340, window.innerWidth - VIEWPORT_MARGIN * 2);
  }

  private tooltipHeight(): number {
    const measured = this.tooltip()?.nativeElement.offsetHeight ?? 0;
    return measured > 0 ? measured : 240;
  }

  /** Moves focus to the tooltip so screen readers announce the new step. */
  private focusTooltip(): void {
    setTimeout(() => this.tooltip()?.nativeElement.focus(), 60);
  }

  /* ------------------------------ controls ------------------------------ */

  protected next(): void {
    void this.tour.next();
  }

  protected previous(): void {
    void this.tour.previous();
  }

  protected askToSkip(): void {
    this.tour.askToSkip();
  }

  protected cancelSkip(): void {
    this.tour.cancelSkip();
  }

  protected confirmSkip(): void {
    this.tour.skip();
  }

  /**
   * Escape asks to skip rather than skipping outright.
   *
   * Losing the tour to a stray keypress, with no way back except Settings, is
   * a worse outcome than one extra confirmation.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (!this.active() || this.confirmingSkip()) {
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.askToSkip();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.next();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.previous();
        break;
      default:
        break;
    }
  }
}
