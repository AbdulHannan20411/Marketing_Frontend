import { Directive, computed, input } from '@angular/core';

/** A destructive item reads differently, because it cannot be taken back. */
export type MenuItemTone = 'default' | 'danger';

/**
 * Styles a button or a link as one row of a menu.
 *
 * Exists so that every row-actions menu in the app looks and behaves the same
 * without each screen hand-writing a dozen classes — and so that adding an
 * item is one line rather than a copied block. The menu semantics live here
 * too: `role="menuitem"` belongs on the item, not on its container.
 *
 * ```html
 * <button appMenuItem (click)="edit(row)">Edit</button>
 * <button appMenuItem tone="danger" (click)="remove(row)">Delete</button>
 * ```
 */
@Directive({
  selector: '[appMenuItem]',
  host: {
    type: 'button',
    role: 'menuitem',
    '[class]': 'classes()',
  },
})
export class MenuItemDirective {
  readonly tone = input<MenuItemTone>('default');

  /**
   * Full width and left-aligned, because a menu is a list of choices rather
   * than a row of buttons: the eye should travel down one edge.
   */
  protected readonly classes = computed(() =>
    [
      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm',
      'transition-colors disabled:cursor-not-allowed disabled:opacity-40',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
      this.tone() === 'danger'
        ? 'text-danger hover:bg-red-50 disabled:hover:bg-transparent'
        : 'text-ink-soft hover:bg-surface-muted hover:text-ink disabled:hover:bg-transparent',
    ].join(' '),
  );
}
