import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import type { ApiError } from '@core/models/api.model';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

/** Which flow this screen is serving; both set a password against a token. */
export type SetPasswordMode = 'invitation' | 'reset';

/** Mirrors the API policy so the rules are visible before submitting. */
const MIN_LENGTH = 12;

interface PasswordRule {
  readonly label: string;
  readonly met: boolean;
}

@Component({
  selector: 'app-set-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonDirective, IconComponent],
  templateUrl: './set-password.component.html',
})
export class SetPasswordComponent {
  /** Bound from the route's `data.mode`. */
  readonly mode = input<SetPasswordMode>('invitation');

  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly appName = environment.appName;
  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly passwordVisible = signal(false);

  protected readonly token = computed(() => this.params()?.get('token') ?? '');
  protected readonly hasToken = computed(() => this.token().length > 0);

  protected readonly isInvitation = computed(() => this.mode() === 'invitation');

  protected readonly heading = computed(() =>
    this.isInvitation() ? 'Accept your invitation' : 'Choose a new password',
  );

  protected readonly subheading = computed(() =>
    this.isInvitation()
      ? `Set a password to finish joining ${this.appName} and sign in.`
      : 'Set a new password and you will be signed straight back in.',
  );

  protected readonly submitLabel = computed(() =>
    this.isInvitation() ? 'Create account' : 'Update password',
  );

  protected readonly form = this.formBuilder.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(MIN_LENGTH)]],
    confirm: ['', [Validators.required]],
  });

  private readonly password = toSignal(this.form.controls.password.valueChanges, {
    initialValue: '',
  });

  private readonly confirm = toSignal(this.form.controls.confirm.valueChanges, {
    initialValue: '',
  });

  /** Shown live so the requirements are met before the server is asked. */
  protected readonly rules = computed<readonly PasswordRule[]>(() => {
    const value = this.password();
    return [
      { label: `At least ${MIN_LENGTH} characters`, met: value.length >= MIN_LENGTH },
      { label: 'Contains a letter', met: /[a-zA-Z]/.test(value) },
      { label: 'Contains a digit', met: /\d/.test(value) },
    ];
  });

  protected readonly allRulesMet = computed(() => this.rules().every((rule) => rule.met));

  protected readonly mismatch = computed(
    () => this.confirm().length > 0 && this.confirm() !== this.password(),
  );

  /** Coarse strength read, purely to give the field some feedback. */
  protected readonly strength = computed(() => {
    const value = this.password();
    if (value.length === 0) {
      return { score: 0, label: '', tone: '' };
    }

    let score = this.rules().filter((rule) => rule.met).length;
    if (value.length >= 16) {
      score++;
    }
    if (/[^a-zA-Z0-9]/.test(value)) {
      score++;
    }

    if (score <= 2) {
      return { score: 33, label: 'Weak', tone: 'bg-red-500' };
    }
    if (score <= 4) {
      return { score: 66, label: 'Good', tone: 'bg-amber-500' };
    }
    return { score: 100, label: 'Strong', tone: 'bg-brand-500' };
  });

  protected readonly canSubmit = computed(
    () => this.hasToken() && this.allRulesMet() && !this.mismatch() && this.confirm().length > 0,
  );

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected submit(): void {
    if (!this.canSubmit() || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formError.set(null);

    const token = this.token();
    const password = this.form.controls.password.value;

    const request$ = this.isInvitation()
      ? this.auth.acceptInvitation(token, password)
      : this.auth.resetPassword(token, password);

    request$.subscribe({
      // Both endpoints return a token pair, so the user lands signed in.
      next: (user) =>
        void this.router.navigateByUrl(user.isSuperAdmin ? '/superadmin/dashboard' : '/dashboard'),
      error: (error: ApiError) => {
        this.submitting.set(false);
        this.formError.set(
          error.detail || 'That link may have expired. Ask for a new one and try again.',
        );
      },
    });
  }
}
