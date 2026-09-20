import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { WritableSignal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { errorInterceptor } from '@core/interceptors/error.interceptor';
import type { AutoReplySettings, AutoReplyTrigger } from '@core/models/auto-reply.model';

import { environment } from '../../../../environments/environment';
import { AutoReplyComponent } from './auto-reply.component';

/** The signals the screen keeps its draft in. Protected on the component, by design. */
interface Draft {
  readonly enabled: WritableSignal<boolean>;
  readonly triggers: WritableSignal<Record<AutoReplyTrigger, boolean>>;
  save(): void;
}

const SETTINGS: AutoReplySettings = {
  enabled: false,
  triggers: { greeting: false, first_message: false, unanswered: false },
  allowedTriggers: { greeting: true, first_message: false, unanswered: false },
  delaySeconds: 60,
  unansweredAfterMinutes: 300,
  instructions: '',
  maxPerConversationPerDay: 2,
  monthlyLimit: null,
  usedThisPeriod: 0,
  remainingThisPeriod: null,
  periodEndsAt: '2026-10-14T07:32:53Z',
  assistantConfigured: true,
};

/**
 * What a refused save does to the rest of the form.
 *
 * Written after auto-reply sat switched off for a day: the admin turned the master switch on and
 * ticked an occasion the plan did not sell, the API refused the whole save, and the screen reloaded
 * itself — putting the switch back to off without saying so. Every later save then carried
 * `enabled: false`, and nothing ever answered a customer.
 */
describe('AutoReplyComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AutoReplyComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });

  function open(): { draft: Draft; http: HttpTestingController } {
    const fixture = TestBed.createComponent(AutoReplyComponent);
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${environment.apiBaseUrl}/whatsapp/auto-reply`).flush({
      data: SETTINGS,
      message: null,
      traceId: null,
    });
    fixture.detectChanges();

    return { draft: fixture.componentInstance as unknown as Draft, http };
  }

  it('keeps the master switch when the plan refuses an occasion', () => {
    const { draft, http } = open();

    draft.enabled.set(true);
    draft.triggers.set({ greeting: true, first_message: false, unanswered: true });

    draft.save();

    http.expectOne(`${environment.apiBaseUrl}/whatsapp/auto-reply`).flush(
      {
        errorCode: 'auto_reply_trigger_not_in_plan',
        detail: 'The Testing plan does not include automatic replies for unanswered messages.',
      },
      { status: 409, statusText: 'Conflict' },
    );

    // The screen re-reads what the plan sells...
    http.expectOne(`${environment.apiBaseUrl}/whatsapp/auto-reply`).flush({
      data: SETTINGS,
      message: null,
      traceId: null,
    });

    // ...and keeps everything the refusal was not about.
    expect(draft.enabled()).toBe(true);
    expect(draft.triggers().greeting).toBe(true);

    // Only the occasion the plan does not sell is cleared, so the next save can go through.
    expect(draft.triggers().unanswered).toBe(false);

    // No `http.verify()`: the knowledge panel on the same screen issues its own request, and
    // answering it here only teaches this test about a component it is not testing.
  });
});
