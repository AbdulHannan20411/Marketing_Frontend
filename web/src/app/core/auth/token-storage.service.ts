import { Injectable } from '@angular/core';
import type { AuthTokens } from '@core/models/auth.model';

const ACCESS_KEY = 'vd.access';
const REFRESH_KEY = 'vd.refresh';

/**
 * Persists tokens in localStorage when the user opted into "remember me",
 * otherwise in sessionStorage so the session dies with the tab.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  private get store(): Storage {
    return localStorage.getItem(ACCESS_KEY) !== null ? localStorage : sessionStorage;
  }

  save(tokens: AuthTokens, persistent: boolean): void {
    this.clear();
    const target = persistent ? localStorage : sessionStorage;
    target.setItem(ACCESS_KEY, tokens.accessToken);
    target.setItem(REFRESH_KEY, tokens.refreshToken);
  }

  get accessToken(): string | null {
    return this.store.getItem(ACCESS_KEY);
  }

  get refreshToken(): string | null {
    return this.store.getItem(REFRESH_KEY);
  }

  get isPersistent(): boolean {
    return localStorage.getItem(ACCESS_KEY) !== null;
  }

  clear(): void {
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem(ACCESS_KEY);
      store.removeItem(REFRESH_KEY);
    }
  }
}
