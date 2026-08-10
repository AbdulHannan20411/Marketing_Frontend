import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

@Component({
  selector: 'app-forgot-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonDirective, IconComponent],
  template: `
    <div class="flex min-h-dvh items-center justify-center bg-surface px-6 py-12">
      <div class="w-full max-w-sm animate-rise">
        @if (sent()) {
          <div class="text-center">
            <div
              class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600"
            >
              <app-icon name="envelope" [size]="26" />
            </div>
            <h1 class="mt-5 text-xl font-semibold tracking-tight text-ink">Check your inbox</h1>
            <p class="mt-2 text-sm text-ink-muted">
              If an account exists for
              <span class="font-medium text-ink">{{ form.controls.email.value }}</span
              >, a reset link is on its way.
            </p>
            <a appButton variant="outline" routerLink="/auth/login" class="mt-6">Back to sign in</a>
          </div>
        } @else {
          <h1 class="text-2xl font-semibold tracking-tight text-ink">Reset your password</h1>
          <p class="mt-1.5 text-sm text-ink-muted">
            We'll email you a link to choose a new password.
          </p>

          <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 space-y-4" novalidate>
            <div>
              <label for="reset-email" class="block text-sm font-medium text-ink-soft">
                Work email
              </label>
              <input
                id="reset-email"
                type="email"
                formControlName="email"
                autocomplete="email"
                placeholder="you@company.com"
                [attr.aria-invalid]="form.controls.email.touched && form.controls.email.invalid"
                class="mt-1.5 h-11 w-full rounded-lg border-0 bg-surface px-3 text-sm text-ink ring-1 ring-line ring-inset transition-shadow placeholder:text-ink-muted focus:ring-2 focus:ring-brand-500 focus:outline-none aria-[invalid=true]:ring-red-400"
              />
              @if (form.controls.email.touched && form.controls.email.invalid) {
                <p class="mt-1.5 text-xs text-danger">Enter a valid email address.</p>
              }
            </div>

            <button appButton size="lg" [block]="true" type="submit" [disabled]="submitting()">
              {{ submitting() ? 'Sending…' : 'Send reset link' }}
            </button>
          </form>

          <a
            routerLink="/auth/login"
            class="mt-6 inline-flex items-center gap-1.5 rounded text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            <app-icon name="chevronLeft" [size]="15" />
            Back to sign in
          </a>
        }
      </div>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.auth.forgotPassword(this.form.getRawValue()).subscribe({
      // Always report success so the form cannot be used to probe for accounts.
      next: () => this.sent.set(true),
      error: () => this.sent.set(true),
    });
  }
}
