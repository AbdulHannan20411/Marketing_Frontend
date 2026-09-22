import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { environment } from '@env/environment';
import { AuditHistoryComponent } from './audit-history.component';

@Component({
  imports: [AuditHistoryComponent],
  template: '<app-audit-history entityName="Template" entityId="tpl_1" recordLabel="Template" />',
})
class HostComponent {}

/** Records history for one template, in the shape the audit table stores. */
const HISTORY = {
  items: [
    {
      id: 'aud_2',
      entityName: 'Template',
      entityId: 'tpl_1',
      action: 'updated',
      userId: 'usr_9',
      userName: 'John Rivera',
      occurredAt: '2026-09-22T11:45:00Z',
      changes: {
        Name: { old: 'Template A', new: 'Template B' },
        Status: { old: 'Draft', new: 'Published' },
        PasswordHash: { redacted: true },
      },
    },
    {
      id: 'aud_1',
      entityName: 'Template',
      entityId: 'tpl_1',
      action: 'created',
      userId: 'usr_1',
      userName: 'Ayesha Khan',
      occurredAt: '2026-09-22T10:30:00Z',
      changes: { Name: { new: 'Template A' } },
    },
  ],
  page: 1,
  pageSize: 10,
  totalItems: 2,
  totalPages: 1,
};

describe('AuditHistoryComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(HostComponent);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function open(body: unknown = HISTORY, status?: { status: number; statusText: string }): string {
    fixture.detectChanges();
    const request = http.expectOne(
      (candidate) => candidate.url === `${environment.apiBaseUrl}/audit/Template/tpl_1`,
    );
    if (status === undefined) {
      request.flush({ data: body, message: null, traceId: null });
    } else {
      request.flush({ title: 'Not allowed', detail: 'You cannot view this record.' }, status);
    }
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('asks for the record own history, newest page first', () => {
    fixture.detectChanges();
    const request = http.expectOne(
      (candidate) => candidate.url === `${environment.apiBaseUrl}/audit/Template/tpl_1`,
    );
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('10');
    request.flush({ data: HISTORY, message: null, traceId: null });
  });

  it('sends only the filters that are set', () => {
    // `?action=&from=` reached the API as an empty enum and an empty date, which
    // it rejects — so every unfiltered read failed and looked like "no history".
    fixture.detectChanges();
    const request = http.expectOne(
      (candidate) => candidate.url === `${environment.apiBaseUrl}/audit/Template/tpl_1`,
    );

    expect(request.request.params.has('action')).toBeFalse();
    expect(request.request.params.has('userId')).toBeFalse();
    expect(request.request.params.has('from')).toBeFalse();
    expect(request.request.params.has('to')).toBeFalse();
    request.flush({ data: HISTORY, message: null, traceId: null });
  });

  it('keeps the entries on screen while a filter refetches, rather than flashing', () => {
    open();
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.trim() === 'Updated')?.click();
    fixture.detectChanges();

    // Still the old rows, dimmed — no skeletons, so the dialog keeps its size.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Template B');
    expect((fixture.nativeElement as HTMLElement).querySelector('ol')?.className).toContain('opacity-50');

    http
      .expectOne((candidate) => candidate.url === `${environment.apiBaseUrl}/audit/Template/tpl_1`)
      .flush({ data: HISTORY, message: null, traceId: null });
  });

  it('shows who changed what, and when', () => {
    const text = open();

    expect(text).toContain('Updated');
    expect(text).toContain('John Rivera');
    expect(text).toContain('Created');
    expect(text).toContain('Ayesha Khan');
    // Three, because a redacted field did change — its values simply are not recorded.
    expect(text).toContain('3 fields changed');
  });

  it('shows old beside new for the changed fields only', () => {
    const text = open();

    expect(text).toContain('Template A');
    expect(text).toContain('Template B');
    expect(text).toContain('Draft');
    expect(text).toContain('Published');
    // A field nobody touched is not in the payload, so it cannot be on screen.
    expect(text).not.toContain('Category');
  });

  it('says a redacted field changed without showing its values', () => {
    const text = open();
    expect(text).toContain('Password');
    expect(text).toContain('changed');
  });

  it('shows a create as values with no "before" column', () => {
    open();
    const headers = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('table'),
    ).map((table) => Array.from(table.querySelectorAll('th')).map((cell) => cell.textContent?.trim()));

    expect(headers[0]).toEqual(['Field', 'Old value', 'New value']);
    expect(headers[1]).toEqual(['Field', 'Value']);
  });

  it('offers the empty state when a record has no history', () => {
    const text = open({ items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
    expect(text).toContain('No history yet');
  });

  it('shows the error state when the API refuses — history follows the record own permissions', () => {
    const text = open(null, { status: 403, statusText: 'Forbidden' });
    expect(text).toContain('Could not load the history');
  });

  it('says so, rather than erroring, on an API with no audit endpoint', () => {
    const text = open(null, { status: 404, statusText: 'Not Found' });
    expect(text).toContain('History is not available yet');
  });

  it('refetches with the filter when one is chosen', () => {
    open();
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const updatedFilter = buttons.find((button) => button.textContent?.trim() === 'Updated');
    expect(updatedFilter).toBeDefined();

    updatedFilter?.click();
    fixture.detectChanges();

    const request = http.expectOne(
      (candidate) => candidate.url === `${environment.apiBaseUrl}/audit/Template/tpl_1`,
    );
    expect(request.request.params.get('action')).toBe('updated');
    request.flush({ data: HISTORY, message: null, traceId: null });
  });
});
