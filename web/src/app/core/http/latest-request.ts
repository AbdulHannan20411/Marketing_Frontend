import { DestroyRef, inject } from '@angular/core';
import { Observable, type MonoTypeOperatorFunction, type Subscription } from 'rxjs';

/**
 * Keeps one request in flight and cancels the ones it overtakes.
 *
 * Every list screen reloads on a filter, a page or a debounced keystroke, and
 * each reload was an independent `subscribe`. Two problems came with that, and
 * both only appear on a slow connection — which is exactly where they matter:
 *
 * - **The wrong answer wins.** Type "ab", then "abc": if the first response is
 *   slower it lands last, and the table shows results for "ab" under a search
 *   box reading "abc". Nothing on screen says anything is wrong.
 * - **Work outlives the screen.** Navigating away mid-request left the
 *   response to arrive and write into a component nobody was looking at.
 *
 * Starting a newer request unsubscribes the previous one, which cancels the
 * HTTP request outright rather than merely ignoring its answer, and everything
 * is tied to the component's own lifetime.
 *
 * Create it in an injection context — a field initialiser — and pipe each
 * reload through it:
 *
 * ```ts
 * private readonly listRequest = latestRequest();
 *
 * this.contacts.list(query).pipe(this.listRequest.only()).subscribe({ ... });
 * ```
 */
export interface LatestRequest {
  /** Cancels whatever this holder has in flight, then runs this one. */
  only<T>(): MonoTypeOperatorFunction<T>;
  /** Cancels whatever is in flight, if anything. */
  cancel(): void;
}

export function latestRequest(): LatestRequest {
  let current: Subscription | null = null;

  const cancel = (): void => {
    current?.unsubscribe();
    current = null;
  };

  inject(DestroyRef).onDestroy(cancel);

  return {
    only<T>(): MonoTypeOperatorFunction<T> {
      return (source) =>
        new Observable<T>((subscriber) => {
          cancel();
          const subscription = source.subscribe(subscriber);
          current = subscription;
          return () => subscription.unsubscribe();
        });
    },
    cancel,
  };
}
