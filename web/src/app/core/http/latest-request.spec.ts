import { provideHttpClient } from '@angular/common/http';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { latestRequest, type LatestRequest } from './latest-request';

/**
 * The race these exist for: two reads of the same list, the first slower than
 * the second. Without cancellation the slower answer lands last and wins.
 */
describe('latestRequest', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let requests: LatestRequest;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    requests = TestBed.runInInjectionContext(() => latestRequest());
  });

  afterEach(() => backend.verify());

  it('cancels the previous request when a newer one starts', () => {
    const seen: string[] = [];

    http.get<string>('/list?q=ab').pipe(requests.only()).subscribe((v) => seen.push(v));
    const first = backend.expectOne('/list?q=ab');

    http.get<string>('/list?q=abc').pipe(requests.only()).subscribe((v) => seen.push(v));
    const second = backend.expectOne('/list?q=abc');

    // Cancelled outright, not merely ignored — the request is gone from the wire.
    expect(first.cancelled).toBeTrue();

    second.flush('abc');
    expect(seen).toEqual(['abc']);
  });

  it('ignores an answer from a source it has already overtaken', () => {
    // The HTTP case above can only be proven once: a cancelled request cannot
    // be flushed at all. This is the same rule against a source that is still
    // able to emit — a stale answer arriving last must not reach the screen.
    const stale = new Subject<string>();
    const fresh = new Subject<string>();
    const seen: string[] = [];

    stale.pipe(requests.only()).subscribe((value) => seen.push(value));
    fresh.pipe(requests.only()).subscribe((value) => seen.push(value));

    fresh.next('abc');
    stale.next('ab');

    expect(seen).toEqual(['abc']);
  });

  it('cancel() stops what is in flight', () => {
    http.get<string>('/list').pipe(requests.only()).subscribe();
    const pending = backend.expectOne('/list');

    requests.cancel();

    expect(pending.cancelled).toBeTrue();
  });
});
