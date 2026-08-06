import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, shareReplay, tap, throwError } from 'rxjs';

import { environment } from '@env/environment';
import type { ApiResponse } from '@core/models/api.model';
import type {
  AuthTokens,
  AuthUser,
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

  private readonly currentUser = signal<AuthUser | null>(this.restoreUser());
  /** In-flight refresh, shared so concurrent 401s trigger exactly one round trip. */
  private refresh$: Observable<AuthTokens> | null = null;

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly role = computed<UserRole | null>(() => this.currentUser()?.role ?? null);
  readonly isSuperAdmin = computed(() => this.role() === 'SuperAdmin');
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

  login(request: LoginRequest): Observable<AuthUser> {
    return this.http.post<ApiResponse<AuthTokens>>(`${this.baseUrl}/login`, request).pipe(
      map((response) => response.data),
      map((tokens) => this.acceptTokens(tokens, request.rememberMe)),
    );
  }

  forgotPassword(request: ForgotPasswordRequest): Observable<void> {
    return this.http
      .post<ApiResponse<null>>(`${this.baseUrl}/forgot-password`, request)
      .pipe(map(() => undefined));
  }

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
          this.acceptTokens(tokens, this.storage.isPersistent);
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

  /**
   * Drops local session state without navigating. Used when a sign-in succeeds
   * but the account is not valid for the portal it was attempted from.
   */
  discardSession(): void {
    this.storage.clear();
    this.currentUser.set(null);
    this.refresh$ = null;
  }

  /** Drops local session state and returns to login, preserving the attempted URL. */
  clearSession(redirectTo?: string): void {
    this.storage.clear();
    this.currentUser.set(null);
    this.refresh$ = null;
    void this.router.navigate(['/auth/login'], {
      queryParams: redirectTo !== undefined ? { returnUrl: redirectTo } : {},
    });
  }

  private acceptTokens(tokens: AuthTokens, persistent: boolean): AuthUser {
    this.storage.save(tokens, persistent);
    const claims = decodeJwt(tokens.accessToken);
    if (claims === null) {
      this.storage.clear();
      throw new Error('Received a malformed access token.');
    }
    const user = toAuthUser(claims);
    this.currentUser.set(user);
    return user;
  }

  private restoreUser(): AuthUser | null {
    const token = this.storage.accessToken;
    if (token === null) {
      return null;
    }
    const claims = decodeJwt(token);
    if (claims === null || isExpired(claims, 0)) {
      this.storage.clear();
      return null;
    }
    return toAuthUser(claims);
  }
}
