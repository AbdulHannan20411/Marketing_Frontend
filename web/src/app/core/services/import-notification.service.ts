import { Injectable, computed, inject } from '@angular/core';
import { EMPTY, concatMap, expand, filter, map, merge, take, takeWhile, timer } from 'rxjs';
import type { Observable } from 'rxjs';

import type { ImportBatch, ImportProgressEvent } from '@core/models/contact-import.model';
import { isTerminalImportStatus } from '@core/models/contact-import.model';
import { ContactImportService } from './contact-import.service';
import { RealtimeService } from './realtime.service';

/**
 * Delays used when the hub is unavailable, in order. The last one repeats.
 *
 * Short at first because a small file finishes almost immediately, then longer
 * so a 100k-row import is not paid for in requests.
 */
const POLL_DELAYS_MS: readonly number[] = [5_000, 5_000, 10_000, 10_000, 15_000];

/**
 * How long to wait between safety-net refetches while the hub *is* connected.
 *
 * Push is the mechanism; this only exists because a dropped event would
 * otherwise leave the page stale with no way to notice.
 */
const CONNECTED_SAFETY_NET_MS = 30_000;

/** Refetch cadence for a *list* while any of its rows is still running. */
const LIST_POLL_MS = 10_000;

/** Hard ceiling, so a batch the server forgets about cannot poll forever. */
const MAX_WATCH_REFETCHES = 240;

/**
 * Keeps import screens current without hammering the API.
 *
 * SignalR is the primary mechanism: the worker pushes `importProgress` and the
 * page refetches straight away. Polling is the fallback, and even then the
 * delays climb and stop the moment the batch settles.
 *
 * A batch is *settled* when nothing will move it without help — either it
 * reached a terminal state, or it is waiting on the user to confirm a mapping.
 * Watching stops in both cases; the component resubscribes after it acts.
 */
@Injectable({ providedIn: 'root' })
export class ImportNotificationService {
  private readonly imports = inject(ContactImportService);
  private readonly realtime = inject(RealtimeService);

  /** True while push is live, so the UI can say so instead of implying polling. */
  readonly isLive = computed(() => this.realtime.state() === 'connected');

  /** Every batch movement for this tenant. Membership is server-side. */
  readonly progress$: Observable<ImportProgressEvent> = this.realtime.importProgress$;

  /**
   * Follows one batch until it settles, emitting the full record each time.
   *
   * Hub events are deliberately not merged into the emission: they carry counts
   * only, while the detail page also needs the mapping, detected columns and
   * error groups. An event is used as a *trigger* to refetch instead, which
   * keeps one source of truth and costs one request per real change.
   */
  watch(batchId: string): Observable<ImportBatch> {
    return this.imports.getImport(batchId).pipe(
      expand((batch, index) =>
        this.isSettled(batch) || index >= MAX_WATCH_REFETCHES
          ? EMPTY
          : this.nextTick(batchId, index).pipe(concatMap(() => this.imports.getImport(batchId))),
      ),
      // `inclusive` so the settling emission — the one the user is waiting for — is delivered.
      takeWhile((batch) => !this.isSettled(batch), true),
    );
  }

  /**
   * Emits whenever a list of batches should be refetched: immediately on any
   * hub event, and on a timer for as long as `stillRunning()` says a row is in
   * flight. The timer is silent once everything has settled.
   */
  refreshSignal$(stillRunning: () => boolean): Observable<void> {
    return merge(
      this.progress$.pipe(map(() => undefined)),
      timer(LIST_POLL_MS, LIST_POLL_MS).pipe(
        filter(() => stillRunning()),
        map(() => undefined),
      ),
    );
  }

  /** Nothing further happens without either a worker finishing or the user acting. */
  private isSettled(batch: ImportBatch): boolean {
    return isTerminalImportStatus(batch.status) || batch.status === 'awaitingMapping';
  }

  /** Whichever comes first: a push for this batch, or the next scheduled check. */
  private nextTick(batchId: string, attempt: number): Observable<unknown> {
    const pushed$ = this.progress$.pipe(filter((event) => event.batchId === batchId));
    return merge(pushed$, timer(this.delayFor(attempt))).pipe(take(1));
  }

  private delayFor(attempt: number): number {
    if (this.isLive()) {
      return CONNECTED_SAFETY_NET_MS;
    }
    return POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];
  }
}
