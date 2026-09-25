import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { environment } from '@env/environment';
import type { AppNotification, AppNotificationDto } from '@core/models/notification.model';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { RealtimeService } from './realtime.service';

/**
 * Deleting is the one notification action that loses something, so these pin
 * the parts a later change could quietly break: that the rows go at once, that
 * a refusal puts them back, and that putting them back cannot swallow a
 * notification that arrived while the request was in flight.
 */
describe('NotificationsService — deleting', () => {
  let service: NotificationsService;
  let http: HttpTestingController;
  let pushed: Subject<AppNotification>;

  const BASE = environment.apiBaseUrl;

  function dto(id: string, read: boolean): AppNotificationDto {
    return {
      id,
      kind: 'campaign.completed',
      category: 'campaigns',
      title: `Campaign ${id}`,
      body: 'Finished sending.',
      priority: 'info',
      icon: 'megaphone',
      read,
      actionLabel: null,
      actionRoute: null,
      occurredAt: `2026-09-2${id.slice(-1)}T10:00:00Z`,
    };
  }

  /** Loads three notifications: two read, one unread. */
  function load(): void {
    service.load();
    http
      .expectOne(`${BASE}/notifications`)
      .flush({ data: [dto('n1', true), dto('n2', false), dto('n3', true)] });
  }

  function ids(): readonly string[] {
    return service.notifications().map((notification) => notification.id);
  }

  beforeEach(() => {
    pushed = new Subject<AppNotification>();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: RealtimeService,
          useValue: { notifications$: pushed.asObservable(), resynced$: new Subject<void>() },
        },
        // Every category on, which is what a new account has.
        { provide: NotificationPreferencesService, useValue: { isEnabled: () => true } },
      ],
    });

    service = TestBed.inject(NotificationsService);
    http = TestBed.inject(HttpTestingController);
    load();
  });

  afterEach(() => http.verify());

  it('keeps the list on screen while refetching', () => {
    // A reconnect refetches. Flipping to the loading state would swap the list
    // for skeletons and back, which is what the page blinking actually was.
    let loadingDuringRefetch: boolean | null = null;

    service.load();
    loadingDuringRefetch = service.isLoading();
    http.expectOne(`${BASE}/notifications`).flush({ data: [dto('n1', true)] });

    expect(loadingDuringRefetch).toBeFalse();
    expect(ids()).toEqual(['n1']);
  });

  it('removes one row before the server answers', () => {
    service.remove('n2');

    expect(ids()).toEqual(['n1', 'n3']);
    const request = http.expectOne(`${BASE}/notifications/n2`);
    expect(request.request.method).toBe('DELETE');
    request.flush({ data: { deleted: 1 } });
  });

  it('puts a row back when the delete is refused', () => {
    service.remove('n2');
    http
      .expectOne(`${BASE}/notifications/n2`)
      .flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });

    expect(ids()).toContain('n2');
  });

  it('treats a 404 as already deleted rather than as a failure', () => {
    // Two tabs, or the bell and the page: the second delete finds nothing.
    // Putting the row back there would be the wrong answer to "it is gone".
    service.remove('n2');
    http
      .expectOne(`${BASE}/notifications/n2`)
      .flush({ message: 'Gone' }, { status: 404, statusText: 'Not Found' });

    expect(ids()).toEqual(['n1', 'n3']);
  });

  it('keeps a notification that arrived while a failing delete was in flight', () => {
    service.remove('n2');

    // The hub pushes between the optimistic removal and the failure. Restoring
    // a snapshot wholesale would throw this away.
    pushed.next({ ...dto('n9', false), occurredAt: '2026-09-25T12:00:00Z' } as AppNotification);

    http
      .expectOne(`${BASE}/notifications/n2`)
      .flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });

    expect(ids()).toContain('n9');
    expect(ids()).toContain('n2');
  });

  it('deletes the selected ids in one request', () => {
    service.removeMany(['n1', 'n3']);

    expect(ids()).toEqual(['n2']);
    const request = http.expectOne(`${BASE}/notifications/delete`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ ids: ['n1', 'n3'] });
    request.flush({ data: { deleted: 2 } });
  });

  it('sends nothing at all for an empty selection', () => {
    service.removeMany([]);

    http.expectNone(`${BASE}/notifications/delete`);
    expect(ids().length).toBe(3);
  });

  it('clears the read ones and leaves the unread where they are', () => {
    service.clear('read');

    expect(ids()).toEqual(['n2']);
    const request = http.expectOne(`${BASE}/notifications/delete`);
    expect(request.request.body).toEqual({ scope: 'read' });
    request.flush({ data: { deleted: 2 } });
  });

  it('sends a scope rather than ids when clearing everything', () => {
    // Ids would leave behind anything raised since the page loaded, which is
    // not what "delete all" means to the person clicking it.
    service.clear('all');

    expect(ids()).toEqual([]);
    const request = http.expectOne(`${BASE}/notifications/delete`);
    expect(request.request.body).toEqual({ scope: 'all' });
    request.flush({ data: { deleted: 3 } });
  });

  it('restores the whole list when clearing is refused', () => {
    service.clear('all');
    http
      .expectOne(`${BASE}/notifications/delete`)
      .flush({ message: 'Nope' }, { status: 500, statusText: 'Server Error' });

    expect(ids().length).toBe(3);
  });
});
