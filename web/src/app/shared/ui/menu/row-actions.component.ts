import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { IconComponent } from '@shared/ui/icon/icon.component';

let nextId = 0;

/**
 * Where the panel sits, in viewport coordinates.
 *
 * One horizontal edge is pinned and the other left alone, so the panel grows
 * away from the trigger rather than over it.
 */
interface Placement {
  readonly top: number;
  readonly left: number | null;
  readonly right: number | null;
}

/** Roughly how much room the panel needs below the trigger before it flips up. */
const ESTIMATED_PANEL_HEIGHT = 200;

/** Roughly how wide it is, for deciding which edge to pin. */
const ESTIMATED_PANEL_WIDTH = 190;

/** The one element every menu's panel is parented to. See `menuLayer`. */
const LAYER_ID = 'app-menu-layer';

/**
 * The shared host at the end of `<body>` that every open menu renders into.
 *
 * One element rather than one per menu: it is created on first use and left
 * there, because a page with a table of forty rows would otherwise add and
 * remove forty wrappers as the pointer moved.
 */
function menuLayer(document: Document): HTMLElement {
  const existing = document.getElementById(LAYER_ID);
  if (existing !== null) {
    return existing;
  }

  const layer = document.createElement('div');
  layer.id = LAYER_ID;
  document.body.appendChild(layer);
  return layer;
}

/**
 * The row's actions, behind one button.
 *
 * Rows used to carry their actions inline — Edit, History, Delete, sometimes
 * five of them — which cost a column of its own on every screen, pushed the
 * data that people actually read off the side on a laptop, and put Delete
 * permanently one stray click from the row above it. One trigger, opened
 * deliberately, is both narrower and safer.
 *
 * Items are projected rather than configured, because a screen's actions are
 * its own: some open a modal, some navigate, some are disabled with a reason.
 * Mark each one with `appMenuItem` and it is styled and announced correctly.
 *
 * ```html
 * <app-row-actions [label]="'Actions for ' + row.name">
 *   <button appMenuItem (click)="edit(row)">Edit</button>
 *   <button appMenuItem tone="danger" (click)="remove(row)">Delete</button>
 * </app-row-actions>
 * ```
 *
 * **The panel is moved to a layer at the end of `<body>`.** This is the same
 * trap `ModalComponent` documents: `position: fixed` is measured against the
 * nearest ancestor carrying a transform, and an interactive card lifts on hover
 * (`.hover-lift:hover { transform: translateY(-2px) }`). So a menu opened from
 * a card — Groups, Tags, Templates, Customers — was positioned inside the card
 * the pointer happened to be over, which put it somewhere below the row and
 * behind the next card, because `.hover-lift` also makes the card a stacking
 * context. It looked like the menu was slow to appear and then appeared in the
 * wrong place; it was in the wrong place immediately, and only looked right
 * once the pointer left the card and the transform cleared.
 *
 * Moving the element out makes the viewport its frame again, wherever the
 * markup happens to live.
 *
 * It is **hidden rather than destroyed** while closed. Projected content is
 * created once with the host, so a panel behind `@if` would have to re-project
 * its items on every open — and `display: none` costs no layout.
 */
@Component({
  selector: 'app-row-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'inline-flex' },
  template: `
    <button
      #trigger
      type="button"
      class="grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
      [attr.id]="triggerId"
      [attr.aria-label]="label()"
      [attr.aria-haspopup]="'menu'"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? menuId : null"
      (click)="toggle($event)"
      (keydown)="onTriggerKeydown($event)"
    >
      <app-icon name="ellipsisVertical" [size]="18" />
    </button>

    <div
      #panel
      role="menu"
      [attr.id]="menuId"
      [attr.aria-labelledby]="triggerId"
      [attr.aria-hidden]="!open()"
      [class.hidden]="!open()"
      class="fixed z-50 min-w-44 rounded-xl border border-line bg-surface p-1 shadow-lg"
      [style.top.px]="placement().top"
      [style.left.px]="placement().left"
      [style.right.px]="placement().right"
      (keydown)="onMenuKeydown($event)"
    >
      <ng-content />
    </div>
  `,
})
export class RowActionsComponent {
  /**
   * What a screen reader announces. Name the record in it — "Actions for Ayesha
   * Khan" — because a table of forty identical "Actions" buttons tells somebody
   * navigating by control nothing about which row they are on.
   */
  readonly label = input('Actions');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  protected readonly open = signal(false);
  protected readonly placement = signal<Placement>({ top: 0, left: 0, right: null });

  protected readonly triggerId = `row-actions-${nextId}`;
  protected readonly menuId = `row-actions-menu-${nextId++}`;

  /** Set while opening by keyboard, so the first item takes focus. */
  private focusFirst = false;

  constructor() {
    const document = this.host.nativeElement.ownerDocument;

    afterNextRender(() => {
      // Out of the row, and out of whatever card or scroll box contains it.
      menuLayer(document).appendChild(this.panel().nativeElement);

      /*
       * Choosing an action closes the menu — in the capture phase, deliberately.
       *
       * A bubbling `(click)` on the panel misses any item that calls
       * `stopPropagation`, and the items that do are exactly the ones that need
       * this most: History stops it so that a clickable row is not also opened,
       * and left the menu sitting open behind its own modal. Capture runs before
       * the item's own handler, so the item cannot opt out. The handler still
       * runs; only the panel's visibility changes, and that lands after the
       * event has finished dispatching.
       */
      this.panel().nativeElement.addEventListener('click', () => this.close(false), true);
    });

    const onPointerDown = (event: Event): void => {
      // Anywhere outside this component closes it, including another row's
      // trigger — which then opens its own, so two menus cannot be open.
      if (!this.host.nativeElement.contains(event.target as Node) && !this.inPanel(event.target)) {
        this.close(false);
      }
    };

    // Followed rather than closed: a menu that vanishes because the page moved
    // a pixel under an inertial scroll is worse than one that keeps up.
    const onViewportChange = (): void => {
      if (this.open()) {
        this.placement.set(this.measure());
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);

    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);

      /*
       * Takes the panel with it.
       *
       * Angular removes a view's nodes through the parent it created them in,
       * so once this one has been moved it is nobody's child as far as the
       * framework is concerned — leaving the page would otherwise leave every
       * row's menu behind in the layer.
       */
      this.panel().nativeElement.remove();
    });
  }

  protected toggle(event: Event): void {
    // Rows are often clickable themselves; opening the menu must not also open
    // the row behind it.
    event.stopPropagation();

    if (this.open()) {
      this.close(true);
      return;
    }

    this.placement.set(this.measure());
    this.open.set(true);
    this.afterOpen();
  }

  /**
   * Closes the menu.
   *
   * @param restoreFocus Whether to put focus back on the trigger — right when
   * the person dismissed it themselves, wrong when they picked an action that
   * moved focus somewhere deliberate, such as into a modal.
   */
  protected close(restoreFocus: boolean): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);

    if (restoreFocus) {
      this.trigger().nativeElement.focus();
    }
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    this.focusFirst = true;

    if (!this.open()) {
      this.placement.set(this.measure());
      this.open.set(true);
    }
    this.afterOpen();
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close(true);
      return;
    }

    if (event.key === 'Tab') {
      // Tab leaves the menu rather than cycling inside it, which is what the
      // key means everywhere else on the page.
      this.close(false);
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();

    const items = this.items();
    if (items.length === 0) {
      return;
    }

    const current = items.indexOf(event.target as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    // Wraps, so a short menu does not dead-end at either edge.
    const next = (current + step + items.length) % items.length;

    items[next].focus();
  }

  /** Enabled items, in the order they are rendered. */
  private items(): readonly HTMLElement[] {
    return [
      ...this.panel().nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].filter((item) => !item.hasAttribute('disabled'));
  }

  /** Focuses the first item once the panel is showing. */
  private afterOpen(): void {
    if (!this.focusFirst) {
      return;
    }
    this.focusFirst = false;

    // After this change detection pass, so the panel is no longer hidden —
    // a `display: none` element cannot take focus.
    setTimeout(() => this.items()[0]?.focus());
  }

  private inPanel(target: EventTarget | null): boolean {
    return target instanceof Node && this.panel().nativeElement.contains(target);
  }

  /**
   * Where the panel goes: under the trigger, aligned to whichever of its edges
   * leaves the panel on screen, and above it when there is no room below.
   *
   * The trigger sits at the **start** of a row, so the panel normally opens
   * rightwards from the trigger's left edge. Near the right edge of the window
   * that would overflow, so the far edges are pinned instead — which is what a
   * menu on a narrow screen, or in a right-hand column, needs.
   */
  private measure(): Placement {
    const rect = this.trigger().nativeElement.getBoundingClientRect();

    const below = window.innerHeight - rect.bottom;
    const flipUp = below < ESTIMATED_PANEL_HEIGHT && rect.top > below;
    const top = flipUp ? Math.max(8, rect.top - ESTIMATED_PANEL_HEIGHT) : rect.bottom + 6;

    const overflowsRight = rect.left + ESTIMATED_PANEL_WIDTH > window.innerWidth - 8;

    return overflowsRight
      ? { top, left: null, right: Math.max(8, window.innerWidth - rect.right) }
      : { top, left: Math.max(8, rect.left), right: null };
  }

  /** True while the menu is showing. For a host that wants to style the row. */
  readonly isOpen = computed(() => this.open());
}
