import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';

import { HistoryButtonComponent } from '@shared/audit/history-button.component';

import { MenuItemDirective } from './menu-item.directive';
import { RowActionsComponent } from './row-actions.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RowActionsComponent, MenuItemDirective],
  template: `
    <div (click)="rowClicked.set(true)">
      <app-row-actions label="Actions for Ayesha Khan">
        <button appMenuItem (click)="chose.set('edit')">Edit</button>
        <button appMenuItem disabled>Cannot</button>
        <button appMenuItem tone="danger" (click)="chose.set('delete')">Delete</button>
      </app-row-actions>
    </div>
  `,
})
class HostComponent {
  readonly chose = signal<string | null>(null);
  /** Rows are often clickable; opening the menu must not open the row. */
  readonly rowClicked = signal(false);
}

/**
 * The row's actions behind one button — so the behaviour has to be right, because
 * a menu that will not close, or that opens the row underneath it, is worse than
 * the three inline buttons it replaced.
 */
describe('RowActionsComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    return {
      fixture,
      host: fixture.componentInstance,
      trigger: () => element.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!,
      /*
       * Queried from the document, not the fixture: the panel is moved out to
       * a layer at the end of `<body>` so no card's hover transform can become
       * its containing block. Hidden rather than destroyed while closed, so
       * "open" is `!classList.contains('hidden')` and not existence.
       */
      panel: () => document.querySelector<HTMLElement>('[role="menu"]'),
      menu: () => {
        const panel = document.querySelector<HTMLElement>('[role="menu"]');
        return panel !== null && !panel.classList.contains('hidden') ? panel : null;
      },
      items: () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')],
    };
  }

  it('renders its panel outside the row, in a layer on the body', () => {
    // The bug this closes: a menu opened from a card was positioned inside
    // whichever card the pointer was over, because `.hover-lift:hover` sets a
    // transform and a transformed ancestor becomes the containing block for a
    // fixed child — and a stacking context, so the next card painted over it.
    const { fixture, trigger, panel } = setup();

    trigger().click();
    fixture.detectChanges();

    expect(panel()!.parentElement?.id).toBe('app-menu-layer');
    expect(panel()!.parentElement?.parentElement).toBe(document.body);
  });

  it('opens on the trigger and lists the projected actions', () => {
    const { fixture, trigger, menu, items } = setup();

    expect(menu()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    trigger().click();
    fixture.detectChanges();

    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(items().map((item) => item.textContent?.trim())).toEqual(['Edit', 'Cannot', 'Delete']);
  });

  it('names the record it belongs to', () => {
    // Forty rows of "Actions" tells somebody navigating by control nothing
    // about which row they are on.
    const { trigger } = setup();

    expect(trigger().getAttribute('aria-label')).toBe('Actions for Ayesha Khan');
  });

  it('does not open the row behind it', () => {
    const { fixture, trigger, host } = setup();

    trigger().click();
    fixture.detectChanges();

    expect(host.rowClicked()).toBeFalse();
  });

  it('runs the action and closes', () => {
    const { fixture, trigger, items, menu, host } = setup();

    trigger().click();
    fixture.detectChanges();

    items()[0].click();
    fixture.detectChanges();

    expect(host.chose()).toBe('edit');
    expect(menu()).toBeNull();
  });

  it('closes on Escape and gives the trigger its focus back', () => {
    const { fixture, trigger, menu } = setup();

    trigger().click();
    fixture.detectChanges();

    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when something outside it is pressed', () => {
    const { fixture, trigger, menu } = setup();

    trigger().click();
    fixture.detectChanges();

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(menu()).toBeNull();
  });

  it('opens on the down arrow with the first item focused', fakeAsync(() => {
    const { fixture, trigger, items } = setup();

    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    tick();

    expect(document.activeElement).toBe(items()[0]);
  }));

  it('skips a disabled item while arrowing, and wraps at the end', fakeAsync(() => {
    const { fixture, trigger, items } = setup();

    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    tick();

    const enabled = items().filter((item) => !item.hasAttribute('disabled'));

    // Edit → Delete: the disabled item is not a stop on the way.
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(enabled[1]);

    // …and past the last one, back to the first.
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(enabled[0]);
  }));

  it('positions itself against the viewport, not its scroll container', () => {
    // Most of these live in a table wrapped in `overflow-x-auto`, which clips
    // an absolutely positioned child — the last row's menu would open inside
    // the scroll box and be cut off. Asserted on what this component sets
    // rather than on the computed style, which would be testing whether
    // Tailwind's stylesheet reached the test bundle.
    const { fixture, trigger, menu } = setup();

    trigger().click();
    fixture.detectChanges();

    const panel = menu()!;

    expect(panel.classList).toContain('fixed');
    // Nothing between it and the body can carry a transform.
    expect(panel.parentElement?.id).toBe('app-menu-layer');
    expect(panel.style.top).toMatch(/px$/);
    // One horizontal edge is pinned and the other left alone, so the panel
    // grows away from the trigger rather than back over it.
    expect([panel.style.left, panel.style.right].filter((value) => value !== '').length).toBe(1);
  });
});

/**
 * A projected action that opens a modal — History, on nine screens.
 *
 * Worth its own test because the panel is hidden with `display: none` while
 * closed, and choosing an action closes the panel. A modal rendered inside the
 * projected content would go invisible with it unless it moves itself out to
 * the body, which `ModalComponent` does. If that ever stops being true, this
 * catches it here rather than as "History does nothing" on every list.
 */
describe('RowActionsComponent with a modal inside it', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RowActionsComponent, MenuItemDirective, HistoryButtonComponent],
    template: `
      <app-row-actions label="Actions for Glow Studio">
        <app-history-button
          entityName="Contact"
          entityId="cnt_1"
          recordName="Glow Studio"
          [menuItem]="true"
        />
      </app-row-actions>
    `,
  })
  class ModalHostComponent {}

  it('shows the modal after the panel that launched it has closed', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    const fixture = TestBed.createComponent(ModalHostComponent);
    fixture.detectChanges();

    const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"]',
    )!;
    trigger.click();
    fixture.detectChanges();

    document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    fixture.detectChanges();

    const panel = document.querySelector<HTMLElement>('[role="menu"]')!;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    // The panel is hidden, and the dialog is out from under it.
    expect(panel.classList).toContain('hidden');
    expect(dialog).not.toBeNull();
    expect(panel.contains(dialog!)).toBeFalse();

    TestBed.inject(HttpTestingController).match(() => true).forEach((request) => request.flush({}));
  });
});
