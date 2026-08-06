import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import type { ApiError } from '@core/models/api.model';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

/** Which entrance this screen is serving. Set from route data. */
export type LoginPortal = 'admin' | 'superadmin';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonDirective, IconComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Bound from the route's `data.portal` via `withComponentInputBinding()`. */
  readonly portal = input<LoginPortal>('admin');

  protected readonly appName = environment.appName;
  protected readonly showMockHint = environment.useMockApi;
  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly passwordVisible = signal(false);

  protected readonly isSuperAdminPortal = computed(() => this.portal() === 'superadmin');

  protected readonly heading = computed(() =>
    this.isSuperAdminPortal() ? 'Super Admin sign-in' : 'Welcome back',
  );

  protected readonly subheading = computed(() =>
    this.isSuperAdminPortal()
      ? 'Platform-wide console. Restricted to Super Admin accounts.'
      : 'Sign in to manage your WhatsApp campaigns.',
  );

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    rememberMe: [true],
  });

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formError.set(null);

    this.auth.login(this.form.getRawValue()).subscribe({
      next: (user) => {
        // Each entrance admits only its own accounts. A valid password for the
        // wrong portal is still a failed sign-in here, so the session is
        // discarded rather than silently landing them in the other console.
        const isSuperAdmin = user.role === 'SuperAdmin';

        if (this.isSuperAdminPortal() && !isSuperAdmin) {
          this.auth.discardSession();
          this.submitting.set(false);
          this.formError.set(
            'That account is not a Super Admin. Sign in at the standard address instead.',
          );
          return;
        }

        if (!this.isSuperAdminPortal() && isSuperAdmin) {
          this.auth.discardSession();
          this.submitting.set(false);
          this.formError.set(
            'Super Admin accounts sign in at /superadmin/login.',
          );
          return;
        }

        const fallback = isSuperAdmin ? '/superadmin/dashboard' : '/dashboard';
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? fallback;
        void this.router.navigateByUrl(returnUrl);
      },
      error: (error: ApiError) => {
        this.submitting.set(false);
        this.formError.set(error.detail || 'We could not sign you in. Please try again.');
      },
    });
  }

  protected prefill(email: string): void {
    this.form.patchValue({ email, password: 'Password1!' });
  }
}
