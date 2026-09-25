import { TestBed, fakeAsync, tick } from '@angular/core/testing';

import { ToastService } from './toast.service';

describe('ToastService', () => {
  let toasts: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    toasts = TestBed.inject(ToastService);
  });

  it('plays a toast out before removing it', fakeAsync(() => {
    toasts.success('Saved');
    const id = toasts.toasts()[0].id;

    toasts.dismiss(id);

    // Still there, marked as leaving: the element needs to exist for the
    // animation to play. Removing it outright is what made a stack of toasts
    // jump as each one vanished.
    expect(toasts.toasts().length).toBe(1);
    expect(toasts.toasts()[0].leaving).toBeTrue();

    tick(200);
    expect(toasts.toasts().length).toBe(0);

    tick(10_000); // let the auto-dismiss timer expire harmlessly
  }));

  it('ignores a second dismiss while one is leaving', fakeAsync(() => {
    toasts.success('First');
    toasts.success('Second');
    const first = toasts.toasts()[0].id;

    // Double-clicking the close button must not take the toast underneath
    // with it when the list re-indexes.
    toasts.dismiss(first);
    toasts.dismiss(first);
    tick(200);

    expect(toasts.toasts().map((toast) => toast.title)).toEqual(['Second']);

    tick(10_000);
  }));

  it('drops a toast on its own after its duration', fakeAsync(() => {
    toasts.info('Heads up');

    tick(5_000);
    tick(200);

    expect(toasts.toasts().length).toBe(0);
  }));
});
