import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';

import { environment } from '@env/environment';
import type { ExportJob, ExportProgressEvent } from '@core/models/export.model';
import { isTerminalExportStatus } from '@core/models/export.model';
import { ExportNotificationService } from './export-notification.service';
import { ExportsService } from './exports.service';
import { RealtimeService } from './realtime.service';
import { ToastService } from './toast.service';

describe('ExportsService', () => {
  let service: ExportsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(ExportsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the list view state and returns without waiting for a file', () => {
    let accepted: string | undefined;

    service
      .create({
        dataset: 'contacts',
        format: 'csv',
        search: 'john',
        filters: { status: 'Active' },
        sortBy: 'createdAt',
        sortDirection: 'desc',
      })
      .subscribe((response) => {
        accepted = response.jobId;
      });

    const request = http.expectOne(`${environment.apiBaseUrl}/exports`);

    // The view's own state, not a row count and not a page. The export is
    // "everything matching what I am looking at".
    expect(request.request.method).toBe('POST');
    expect(request.request.body.dataset).toBe('contacts');
    expect(request.request.body.search).toBe('john');
    expect(request.request.body.filters.status).toBe('Active');
    expect(request.request.body.sortBy).toBe('createdAt');

    request.flush({ data: { jobId: 'exj_7', status: 'queued', reused: false } });

    expect(accepted).toBe('exj_7');
  });

  it('downloads through the API rather than a link to storage', () => {
    const job = { id: 'exj_7', fileName: 'contacts-2026-09-27.csv' } as ExportJob;

    service.download(job).subscribe();

    // A bearer token cannot ride a plain href, and the storage key never
    // leaves the server — the client only ever holds the job id.
    const request = http.expectOne(`${environment.apiBaseUrl}/exports/exj_7/download`);

    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['a,b\n']));
  });

  it('knows when a page of exports has stopped moving', () => {
    const running = [{ status: 'processing' }, { status: 'completed' }] as ExportJob[];
    const settled = [{ status: 'completed' }, { status: 'failed' }] as ExportJob[];

    expect(ExportsService.anyRunning(running)).toBeTrue();
    expect(ExportsService.anyRunning(settled)).toBeFalse();
  });

  it('formats a file size for the history row', () => {
    expect(ExportsService.formatSize(null)).toBe('—');
    expect(ExportsService.formatSize(512)).toBe('512 B');
    expect(ExportsService.formatSize(2048)).toBe('2 KB');
    expect(ExportsService.formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('isTerminalExportStatus', () => {
  it('treats cancelled and expired as settled, not just completed and failed', () => {
    // Used to decide when to stop watching. Missing one of these polls a job
    // that will never move again.
    expect(isTerminalExportStatus('completed')).toBeTrue();
    expect(isTerminalExportStatus('failed')).toBeTrue();
    expect(isTerminalExportStatus('cancelled')).toBeTrue();
    expect(isTerminalExportStatus('expired')).toBeTrue();
    expect(isTerminalExportStatus('queued')).toBeFalse();
    expect(isTerminalExportStatus('processing')).toBeFalse();
  });
});

describe('ExportNotificationService', () => {
  let notifications: ExportNotificationService;
  let toasts: ToastService;
  let progress: Subject<ExportProgressEvent>;

  const event = (over: Partial<ExportProgressEvent>): ExportProgressEvent => ({
    jobId: 'exj_7',
    dataset: 'contacts',
    datasetName: 'Contacts',
    status: 'processing',
    processedRecords: 100,
    totalRecords: 1000,
    percentage: 10,
    fileName: null,
    errorMessage: null,
    ...over,
  });

  /** Whether SignalR is up. The fallback only runs when it is not. */
  let hubState: 'connected' | 'disconnected';

  beforeEach(() => {
    progress = new Subject<ExportProgressEvent>();
    hubState = 'disconnected';

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: RealtimeService,
          useValue: { exportProgress$: progress.asObservable(), state: () => hubState },
        },
      ],
    });

    notifications = TestBed.inject(ExportNotificationService);
    toasts = TestBed.inject(ToastService);
    notifications.start();
  });

  it('raises a success toast when an export finishes', () => {
    progress.next(event({ status: 'completed', fileName: 'contacts-2026-09-27.csv' }));

    const toast = toasts.toasts().at(-1)!;

    expect(toast.tone).toBe('success');
    expect(toast.title).toContain('Contacts');
    expect(toast.description).toContain('contacts-2026-09-27.csv');
  });

  it('raises an error toast carrying the API sentence, not a stack trace', () => {
    progress.next(
      event({ status: 'failed', errorMessage: 'We could not finish this export.' }),
    );

    const toast = toasts.toasts().at(-1)!;

    expect(toast.tone).toBe('error');
    expect(toast.description).toBe('We could not finish this export.');
  });

  it('says nothing while an export is merely progressing', () => {
    progress.next(event({ status: 'processing' }));
    progress.next(event({ status: 'processing', processedRecords: 900 }));

    // A toast per batch would be twenty toasts for one export. Progress belongs
    // on the export centre and the bar, not in the corner of the screen.
    expect(toasts.toasts().length).toBe(0);
  });

  it('distinguishes an export that started from one already running', () => {
    notifications.announceQueued('Contacts', false);
    expect(toasts.toasts().at(-1)?.title).toBe('Export started');

    // Telling somebody their fifth click started a fifth export would be a lie.
    notifications.announceQueued('Contacts', true);
    expect(toasts.toasts().at(-1)?.title).toContain('already running');
  });

  it('still tells the user when the hub never delivers', fakeAsync(() => {
    /*
     * The reported bug, in one test.
     *
     * The export was queued, the worker wrote the file in under a second, and
     * the person who had been told "we will let you know" was never told
     * anything — because the only listener was SignalR, and the hub had been
     * failing to authorise a hundred times a day. The work was fine; the
     * telling was missing.
     *
     * With the hub down, queuing follows the job over HTTP instead.
     */
    const http = TestBed.inject(HttpTestingController);

    notifications.announceQueued('Contacts', false, 'exj_9');

    // The fallback reads on a timer rather than on the spot, so that a healthy
    // hub gets there first and no request is made at all.
    tick();

    http.expectOne(`${environment.apiBaseUrl}/exports/exj_9`).flush({
      data: {
        id: 'exj_9',
        dataset: 'contacts',
        datasetName: 'Contacts',
        status: 'completed',
        processedRecords: 18,
        totalRecords: 18,
        fileName: 'contacts-2026-09-27.csv',
        fileSizeBytes: 2170,
        errorMessage: null,
      },
      message: null,
      traceId: null,
    });

    const toast = toasts.toasts().at(-1)!;

    expect(toast.tone).toBe('success');
    expect(toast.description).toContain('contacts-2026-09-27.csv');

    // Nothing left ticking once the job is terminal.
    discardPeriodicTasks();
  }));

  it('says a file is ready once, however the news arrives', () => {
    // The hub and the fallback can report the same job in the same second.
    progress.next(event({ status: 'completed', fileName: 'contacts.csv' }));
    progress.next(event({ status: 'completed', fileName: 'contacts.csv' }));

    expect(toasts.toasts().filter((entry) => entry.tone === 'success').length).toBe(1);
  });

  it('tracks which exports are still in flight', () => {
    progress.next(event({ jobId: 'exj_1', status: 'processing' }));
    progress.next(event({ jobId: 'exj_2', status: 'completed' }));

    expect(notifications.running().map((entry) => entry.jobId)).toEqual(['exj_1']);
  });
});
