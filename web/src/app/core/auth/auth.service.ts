import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import { environment } from '@env/environment';
import type { ApiResponse } from '@core/models/api.model';
import type {
  AuthTokens,
  AuthUser,
  UpdateProfileRequest,
  CurrentUserResponse,
  ForgotPasswordRequest,
  LoginRequest,
  Permission,
  UserRole,
} from '@core/models/auth.model';
import { decodeJwt, isExpired, toAuthUser } from './jwt.util';
import { TokenStorageService } from './token-storage.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly storage = inject(TokenStorageService);
  private readonly baseUrl = `${environment.apiBaseUrl}/auth`;

  private readonly currentUser = signal<AuthUser | null>(null);
  /** In-flight refresh, shared so concurrent 401s trigger exactly one round trip. */
  private refresh$: Observable<AuthTokens> | null = null;

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly role = computed<UserRole | null>(() => this.currentUser()?.role ?? null);
  readonly isSuperAdmin = computed(() => this.currentUser()?.isSuperAdmin ?? false);
  readonly isAdmin = computed(() => this.role() === 'Admin');

  hasPermission(permission: Permission): boolean {
    return this.currentUser()?.permissions.includes(permission) ?? false;
  }

  hasAnyPermission(permissions: readonly Permission[]): boolean {
    return permissions.length === 0 || permissions.some((p) => this.hasPermission(p));
  }

  hasRole(roles: readonly UserRole[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  /** True when a token exists, so the app can restore a session on reload. */
  hasStoredSession(): boolean {
    const token = this.storage.accessToken;
    if (token === null) {
      return false;
    }
    const claims = decodeJwt(token);
    return claims !== null && !isExpired(claims, 0);
  }

  get accessToken(): string | null {
    return this.storage.accessToken;
  }

  login(request: LoginRequest): Observable<AuthUser> {
    return this.http.post<ApiResponse<AuthTokens>>(`${this.baseUrl}/login`, request).pipe(
      map((response) => response.data),
      tap((tokens) => this.storage.save(tokens, request.rememberMe)),
      // The token carries no email, so the profile is fetched rather than decoded.
      switchMap(() => this.loadProfile()),
    );
  }

  /**
   * Fetches `GET /auth/me` and adopts it as the session user. Also used on
   * app start to rehydrate from a stored token.
   */
  loadProfile(): Observable<AuthUser> {
    return this.http.get<ApiResponse<CurrentUserResponse>>(`${this.baseUrl}/me`).pipe(
      map((response) => response.data),
      map((profile) => {
        const token = this.storage.accessToken;
        const user = toAuthUser(profile, token === null ? null : decodeJwt(token));
        this.currentUser.set(user);
        return user;
      }),
    );
  }

  /** Restores a session on bootstrap; resolves to null when there is none. */
  restoreSession(): Observable<AuthUser | null> {
    if (!this.hasStoredSession()) {
      this.storage.clear();
      return of(null);
    }
    return this.loadProfile().pipe(
      catchError(() => {
        this.storage.clear();
        this.currentUser.set(null);
        return of(null);
      }),
    );
  }

  forgotPassword(request: ForgotPasswordRequest): Observable<void> {
    return this.http
      .post<ApiResponse<null>>(`${this.baseUrl}/forgot-password`, request)
      .pipe(map(() => undefined));
  }

  /**
   * Updates your own name, email and password, then adopts the result as the
   * session user so the top bar and avatar change immediately.
   *
   * All three apply in **one transaction** server-side, so there is no
   * partial-success case to handle: either everything took, or nothing did.
   *
   * Errors are `422` with **PascalCase** field keys — `CurrentPassword`,
   * `NewPassword`, `Email`, `DisplayName` — or `409 email_in_use`. Callers must
   * look those up case-insensitively.
   *
   * Changing the password revokes every other session; this one survives.
   */
  updateProfile(request: UpdateProfileRequest): Observable<AuthUser> {
    return this.http
      .patch<ApiResponse<CurrentUserResponse>>(`${this.baseUrl}/me`, request)
      .pipe(switchMap(() => this.loadProfile()));
  }

  acceptInvitation(token: string, password: string): Observable<AuthUser> {
    return this.http
      .post<ApiResponse<AuthTokens>>(`${this.baseUrl}/accept-invitation`, { token, password })
      .pipe(
        map((response) => response.data),
        tap((tokens) => this.storage.save(tokens, true)),
        switchMap(() => this.loadProfile()),
      );
  }

  resetPassword(token: string, password: string): Observable<AuthUser> {
    return this.http
      .post<ApiResponse<AuthTokens>>(`${this.baseUrl}/reset-password`, { token, password })
      .pipe(
        map((response) => response.data),
        tap((tokens) => this.storage.save(tokens, true)),
        switchMap(() => this.loadProfile()),
      );
  }

  /**
   * Rotating refresh. Presenting an already-rotated token revokes every session
   * for the user, so this must never run concurrently — the shared observable
   * guarantees a single round trip per burst of 401s.
   */
  refreshToken(): Observable<AuthTokens> {
    if (this.refresh$ !== null) {
      return this.refresh$;
    }

    const refreshToken = this.storage.refreshToken;
    if (refreshToken === null) {
      return throwError(() => new Error('No refresh token available.'));
    }

    this.refresh$ = this.http
      .post<ApiResponse<AuthTokens>>(`${this.baseUrl}/refresh`, { refreshToken })
      .pipe(
        map((response) => response.data),
        tap((tokens) => {
          this.storage.save(tokens, this.storage.isPersistent);
          this.refresh$ = null;
        }),
        catchError((error: unknown) => {
          this.refresh$ = null;
          this.clearSession();
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    return this.refresh$;
  }

  logout(): void {
    this.http.post<ApiResponse<null>>(`${this.baseUrl}/logout`, {}).subscribe({
      error: () => undefined,
    });
    this.clearSession();
  }

  logoutEverywhere(): void {
    this.http.post<ApiResponse<null>>(`${this.baseUrl}/logout-everywhere`, {}).subscribe({
      error: () => undefined,
    });
    this.clearSession();
  }

  /** Drops local session state without navigating. */
  discardSession(): void {
    this.storage.clear();
    this.currentUser.set(null);
    this.refresh$ = null;
  }

  /** Drops local session state and returns to login, preserving the attempted URL. */
  clearSession(redirectTo?: string): void {
    const wasSuperAdmin = this.isSuperAdmin();
    this.discardSession();

    void this.router.navigate([wasSuperAdmin ? '/superadmin/login' : '/auth/login'], {
      queryParams: redirectTo !== undefined ? { returnUrl: redirectTo } : {},
    });
  }
}
