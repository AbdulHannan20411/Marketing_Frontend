import { Component, computed, signal } from '@angular/core';
import { TestBed, fakeAsync, tick, type ComponentFixture } from '@angular/core/testing';
import { of, type Observable } from 'rxjs';

import type { PagedResult } from '@core/models/api.model';
import {
  ContactListComponent,
  type ContactListRow,
  type ContactListSource,
} from './contact-list.component';

interface Call {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly filter: string;
}

const calls: Call[] = [];
let answer: PagedResult<ContactListRow> = page(0, 0);

function page(count: number, total: number): PagedResult<ContactListRow> {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      id: `cnt_${index}`,
      fullName: `Contact ${index}`,
      initials: 'C',
      phoneNumber: '+441234567890',
      status: 'subscribed' as const,
    })),
    totalItems: total,
    page: 1,
    pageSize: 2,
    totalPages: 1,
  };
}

@Component({
  imports: [ContactListComponent],
  template: `
    <app-contact-list [source]="source()" [pageSize]="2" [searchable]="true" />
  `,
})
class HostComponent {
  readonly filter = signal('grp_1');

  /** A computed, as the component requires: stable while the filter is. */
  readonly source = computed<ContactListSource>(() => {
    const filter = this.filter();

    return (pageNumber, pageSize, search): Observable<PagedResult<ContactListRow>> => {
      calls.push({ page: pageNumber, pageSize, search, filter });
      return of(answer);
    };
  });
}

/**
 * The component owns paging, search and the states; the caller owns the
 * request. These pin the contract between the two.
 */
describe('ContactListComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(() => {
    calls.length = 0;
    answer = page(2, 40_000);
    fixture = TestBed.createComponent(HostComponent);
  });

  it('reads the first page through the source it was given', () => {
    fixture.detectChanges();

    expect(calls).toEqual([{ page: 1, pageSize: 2, search: '', filter: 'grp_1' }]);
    expect(text()).toContain('Contact 0');
  });

  it('re-reads when the source changes, from page one', () => {
    fixture.detectChanges();
    fixture.componentInstance.filter.set('grp_2');
    fixture.detectChanges();

    // A dialog whose group can be switched must not have to be torn down.
    expect(calls.length).toBe(2);
    expect(calls[1]).toEqual({ page: 1, pageSize: 2, search: '', filter: 'grp_2' });
  });

  it('passes a debounced search term to the source', fakeAsync(() => {
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;

    input.value = 'ayesha';
    input.dispatchEvent(new Event('input'));
    tick(100);
    expect(calls.length).toBe(1); // still waiting

    tick(300);
    expect(calls[1].search).toBe('ayesha');
  }));

  it('says nobody matches when a search comes back empty', fakeAsync(() => {
    fixture.detectChanges();
    answer = page(0, 0);

    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    input.value = 'nobody';
    input.dispatchEvent(new Event('input'));
    tick(400);
    fixture.detectChanges();

    // Different wording from an empty group: one is a failed search, the
    // other is an empty list.
    expect(text()).toContain('Nobody matches that');
  }));
});
