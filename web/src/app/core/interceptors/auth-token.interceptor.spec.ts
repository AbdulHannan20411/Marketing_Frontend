import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import { TokenStorageService } from '@core/auth/token-storage.service';
import type { AuthTokens } from '@core/models/auth.model';
import { authTokenInterceptor } from './auth-token.interceptor';

/**
 * The two rules session security depends on: every call carries the device id
 * — sign-in most of all — and a session ended elsewhere is signed out with its
 * reason instead of being "refreshed", which would fail and lose the reason.
 */
describe('authTokenInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: jasmine.SpyObj<AuthService>;

  const api = (path: string): string => `${environment.apiBaseUrl}${path}`;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['refreshToken', 'clearSession', 'endRevokedSession']);
    const tokens: AuthTokens = { accessToken: 'fresh', refreshToken: 'r', expiresAtUtc: '' };
    auth.refreshToken.and.returnValue(of(tokens));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authTokenInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: TokenStorageService, useValue: { accessToken: 'stale' } },
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('sends the same device id on every call, sign-in included', () => {
    http.post(api('/auth/login'), {}).subscribe();
    http.get(api('/contacts')).subscribe();

    const login = backend.expectOne(api('/auth/login'));
    const contacts = backend.expectOne(api('/contacts'));

    const id = login.request.headers.get('X-Device-Id');
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(contacts.request.headers.get('X-Device-Id')).toBe(id);
    // Sign-in carries no bearer token, but it still identifies the device.
    expect(login.request.headers.has('Authorization')).toBeFalse();

    login.flush({});
    contacts.flush({});
  });

  it('never sends the device id to a third party', () => {
    http.get('https://example.com/elsewhere').subscribe();
    const request = backend.expectOne('https://example.com/elsewhere');
    expect(request.request.headers.has('X-Device-Id')).toBeFalse();
    request.flush({});
  });

  it('signs a revoked session out without trying to refresh it', () => {
    http.get(api('/contacts')).subscribe({ error: () => undefined });

    backend
      .expectOne(api('/contacts'))
      .flush(null, { status: 401, statusText: 'Unauthorized', headers: { 'X-Session-Revoked': 'true' } });

    expect(auth.endRevokedSession).toHaveBeenCalledTimes(1);
    // The refresh token died with the session; using it would only fail.
    expect(auth.refreshToken).not.toHaveBeenCalled();
  });

  it('still refreshes and retries an ordinary expired token', () => {
    http.get(api('/contacts')).subscribe();

    backend
      .expectOne(api('/contacts'))
      .flush(null, { status: 401, statusText: 'Unauthorized', headers: { 'X-Token-Expired': 'true' } });

    expect(auth.refreshToken).toHaveBeenCalledTimes(1);
    const retry = backend.expectOne(api('/contacts'));
    expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh');
    expect(retry.request.headers.has('X-Device-Id')).toBeTrue();
    retry.flush({});
    expect(auth.endRevokedSession).not.toHaveBeenCalled();
  });
});
