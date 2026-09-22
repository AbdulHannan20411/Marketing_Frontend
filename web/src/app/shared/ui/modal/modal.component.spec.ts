import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  // A card that lifts on hover: a transform, which is a containing block for
  // `position: fixed`. This is where every list's History button lives.
  template: `
    <div class="hover:-translate-y-0.5" style="transform: translateY(-2px)">
      @if (open) {
        <app-modal title="History">content</app-modal>
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
});
