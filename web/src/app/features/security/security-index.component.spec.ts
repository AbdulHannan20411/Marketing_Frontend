import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../environments/environment';
import { SecurityIndexComponent } from './security-index.component';

/** The platform Security page must render — a failure here cancels the navigation to it. */
describe('SecurityIndexComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SecurityIndexComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('renders and lists workspaces from the admin list', () => {
    const fixture = TestBed.createComponent(SecurityIndexComponent);
    fixture.detectChanges();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${environment.apiBaseUrl}/superadmin/admins`).flush({
      data: [
        {
          id: 'adm_1',
          name: 'Ayesha Khan',
          initials: 'AK',
          email: 'ayesha@example.com',
          organisation: 'Glow Studio',
          tenantId: 'tnt_1',
        },
      ],
      message: null,
      traceId: null,
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Glow Studio');
  });
});
