import { Injectable, computed, inject, signal } from '@angular/core';
import { EMPTY, catchError, filter, merge, map, switchMap, takeWhile, timer } from 'rxjs';
import type { Observable } from 'rxjs';

import type { ExportJob, ExportProgressEvent } from '@core/models/export.model';
import { isTerminalExportStatus } from '@core/models/export.model';
import { ExportsService } from './exports.service';
import { RealtimeService } from './realtime.service';
import { ToastService } from './toast.service';

/**
 * How often to check on running exports when the hub is unavailable.
 *
 * Only ever used as a fallback — SignalR is the mechanism. Slow on purpose:
 * an export that takes two minutes does not need to be asked about every
 * second, and a client that polls hard is worse than one that is a little late.
 */
const FALLBACK_POLL_MS = 10_000;

/**
 * Follows the user's exports and tells them when one is ready.
 *
 * Injected once at the shell, so a toast arrives wherever the user happens to
 * be — the whole point of the feature is that they carried on working. The
 * export centre listens to the same signals rather than polling on its own.
 */
@Injectable({ providedIn: 'root' })
export class ExportNotificationService {
  private readonly exports = inject(ExportsService);
  private readonly realtime = inject(RealtimeService);
  private readonly toasts = inject(ToastService);

  /** Jobs this session has seen move, newest state per id. */
  private readonly seen = signal<ReadonlyMap<string, ExportProgressEvent>>(new Map());

  /** True while push is live, so the UI can say so instead of implying polling. */
  readonly isLive = computed(() => this.realtime.state() === 'connected');

  /** Exports this session knows are still running. */
  readonly running = computed(() =>
    [...this.seen().values()].filter((event) => !isTerminalExportStatus(event.status)),
  );

  /** Every export movement for this user. Membership is server-side. */
  readonly progress$: Observable<ExportProgressEvent> = this.realtime.exportProgress$;

  /**
   * Starts listening. Called once, from the shell.
   *
   * Idempotent: a second call is ignored, so a component that starts it on
   * init does not stack subscriptions across navigations.
   */
  private started = false;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.progress$.subscribe((event) => this.record(event));
  }

  /**
   * Says an export has been queued.
   *
   * Two different sentences, because "already running" and "started" are
   * different facts and telling somebody their fifth click started a fifth
   * export would be a lie.
   */
  announceQueued(datasetName: string, reused: boolean, jobId?: string): void {
    if (jobId !== undefined) {
      this.follow(jobId);
    }

    if (reused) {
      this.toasts.info(
        `Your ${datasetName} export is already running`,
        'We will let you know as soon as it is ready.',
      );
      return;
    }

    this.toasts.info(
      'Export started',
      `You can carry on working — we will tell you when your ${datasetName} export is ready.`,
    );
  }

  /**
   * Follows one job to its end, whether or not the hub is up.
   *
   * This is what makes the promise above true. `start()` listens to SignalR
   * and nothing else, so when the hub cannot authorise — and it has been
   * failing, more than a hundred times a day — the export finished, the file
   * was written, and the person who was told "we will let you know" was never
   * told anything. The work was fine; only the telling was missing.
   *
   * {@link watch} already falls back to a slow poll when the hub is down, so
   * following the job we just queued costs nothing on a healthy connection and
   * closes the silence on a broken one. Stops at the first terminal state.
   */
  private follow(jobId: string): void {
    if (this.followed.has(jobId)) {
      return;
    }
    this.followed.add(jobId);

    this.watch(jobId)
      .pipe(takeWhile((job) => !isTerminalExportStatus(job.status), true))
      .subscribe({
        next: (job) => {
          if (isTerminalExportStatus(job.status)) {
            this.followed.delete(jobId);
            this.record({
              jobId: job.id,
              dataset: job.dataset,
              datasetName: job.datasetName,
              status: job.status,
              processedRecords: job.processedRecords,
              totalRecords: job.totalRecords,
              percentage: 100,
              fileName: job.fileName,
              errorMessage: job.errorMessage,
            });
          }
        },
        error: () => this.followed.delete(jobId),
      });
  }

  /** Jobs already being followed, so a second click does not double the toast. */
  private readonly followed = new Set<string>();

  /**
   * Emits whenever a list of exports should be refetched.
   *
   * Immediately on any push, and on a slow timer only while something is still
   * running *and* the hub is down. With a healthy hub this is push-only.
   */
  refreshSignal$(stillRunning: () => boolean): Observable<void> {
    return merge(
      this.progress$.pipe(map(() => undefined)),
      timer(FALLBACK_POLL_MS, FALLBACK_POLL_MS).pipe(
        filter(() => stillRunning() && !this.isLive()),
        map(() => undefined),
      ),
    );
  }

  /**
   * Follows one export until it settles, emitting the full record each time.
   *
   * The hub event is used as a trigger to refetch rather than as the emission:
   * it carries progress only, while a caller usually wants the whole job —
   * file name, size, expiry. One source of truth, one request per real change.
   */
  watch(jobId: string): Observable<ExportJob> {
    return merge(
      this.progress$.pipe(filter((event) => event.jobId === jobId)),
      timer(0, FALLBACK_POLL_MS).pipe(filter(() => !this.isLive())),
    ).pipe(
      switchMap(() => this.exports.get(jobId).pipe(catchError(() => EMPTY))),
    );
  }

  /** Records a movement and raises a toast for the two that matter. */
  private record(event: ExportProgressEvent): void {
    // Once, however the news arrives. A job can be reported by the hub and by
    // the fallback poll in the same second; the person should not be told
    // twice that their file is ready.
    const previous = this.seen().get(event.jobId);
    this.seen.update((current) => new Map(current).set(event.jobId, event));

    if (previous !== undefined && previous.status === event.status) {
      return;
    }

    if (event.status === 'completed') {
      this.toasts.success(
        `Your ${event.datasetName} export is ready`,
        event.fileName ?? 'Open the export centre to download it.',
      );
      return;
    }

    if (event.status === 'failed') {
      // The message is the API's own sentence, which is written for a user.
      // Never a stack trace and never a database error.
      this.toasts.error(
        `Your ${event.datasetName} export failed`,
        event.errorMessage ?? 'Try running it again from the export centre.',
      );
    }
  }
}
