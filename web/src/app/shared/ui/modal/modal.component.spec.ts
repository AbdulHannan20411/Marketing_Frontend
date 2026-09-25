import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  // A card that lifts on hover: a transform, which is a containing block for
  // `position: fixed`. This is where every list's History button lives.
  template: `
    <div class="hover:-translate-y-0.5" style="transform: translateY(-2px)">
      <button id="opener" type="button">Open</button>
      @if (open) {
        <app-modal title="History">
          <button id="first" type="button">First</button>
          <button id="last" type="button">Last</button>
        </app-modal>
      }
    </div>
  `,
})
class HostComponent {
  open = true;
}

describe('ModalComponent', () => {
  it('moves itself out to the body, so a transformed ancestor cannot frame it', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = document.body.querySelector('app-modal');
    const transformed = (fixture.nativeElement as HTMLElement).querySelector('div');

    expect(dialog).not.toBeNull();
    // Directly under body, and no longer inside the transformed wrapper.
    expect(dialog?.parentElement).toBe(document.body);
    expect(transformed?.contains(dialog!)).toBeFalse();
  });

  it('takes its element with it when closed', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.body.querySelector('app-modal')).not.toBeNull();

    fixture.componentInstance.open = false;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.body.querySelector('app-modal')).toBeNull();
  });

  /* ----------------------------- focus ------------------------------ *
   * A dialog the keyboard can walk out of is modal in appearance only:
   * Tab reaches controls behind the scrim, and nothing announces that a
   * dialog opened at all.
   * ------------------------------------------------------------------ */

  it('moves focus into the dialog, onto the dialog itself', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement?.getAttribute('role')).toBe('dialog');

    fixture.destroy();
    opener.remove();
  });

  it('gives focus back to whatever opened it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.open = false;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(opener);

    fixture.destroy();
    opener.remove();
  });

  it('wraps Tab from the last control back to the first', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const modal = document.body.querySelector('app-modal') as HTMLElement;
    const last = modal.querySelector('#last') as HTMLButtonElement;
    last.focus();

    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    fixture.detectChanges();

    // Round to the top of the dialog — its close button — rather than out
    // onto the page behind the scrim.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close dialog');

    fixture.destroy();
  });

  it('locks the page behind it, and unlocks on close', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.body.style.overflow).toBe('hidden');

    fixture.componentInstance.open = false;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.body.style.overflow).toBe('');

    fixture.destroy();
  });
});
