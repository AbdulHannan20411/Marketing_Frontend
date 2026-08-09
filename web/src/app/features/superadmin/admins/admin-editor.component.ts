import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { AdminAccount } from '@core/models/admin-account.model';
import type { TenantPlan } from '@core/models/platform.model';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

export interface AdminEditorResult {
  readonly name: string;
  readonly email: string;
  readonly organisation: string;
  readonly password: string;
  readonly plan: TenantPlan;
}

const PLANS: readonly TenantPlan[] = ['starter', 'growth', 'scale', 'enterprise'];

/**
 * Create or edit an Admin account.
 *
 * On create the API also provisions the organisation and emails an invitation;
 * the password here is only a placeholder hash, because the admin sets their
 * own when they accept. On edit the email is fixed — the API has no route for
 * changing it.
 */
@Component({
  selector: 'app-admin-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent, ButtonDirective, IconComponent],
  templateUrl: './admin-editor.component.html',
})
export class AdminEditorComponent {
  readonly admin = input<AdminAccount | null>(null);
  readonly saving = input(false);

  readonly save = output<AdminEditorResult>();
  readonly cancel = output<void>();

  protected readonly plans = PLANS;

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly organisation = signal('');
  protected readonly password = signal('');
  protected readonly plan = signal<TenantPlan>('starter');

  protected readonly isEdit = computed(() => this.admin() !== null);

  protected readonly title = computed(() =>
    this.isEdit() ? `Edit ${this.admin()?.organisation}` : 'Create admin account',
  );

  protected readonly subtitle = computed(() =>
    this.isEdit()
      ? 'Update the organisation name, contact name and plan band.'
      : 'Creates the organisation and its first administrator, and emails them an invitation.',
  );

  protected readonly nameInvalid = computed(() => this.name().trim().length === 0);
  protected readonly orgInvalid = computed(() => this.organisation().trim().length === 0);

  protected readonly emailInvalid = computed(
    () => !this.isEdit() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim()),
  );

  /** Matches the API policy: at least 12 characters, a letter and a digit. */
  protected readonly passwordInvalid = computed(() => {
    if (this.isEdit()) {
      return false;
    }
    const value = this.password();
    return value.length < 12 || !/[a-zA-Z]/.test(value) || !/\d/.test(value);
  });

  protected readonly invalid = computed(
    () =>
      this.nameInvalid() || this.orgInvalid() || this.emailInvalid() || this.passwordInvalid(),
  );

  constructor() {
    effect(() => {
      const source = this.admin();
      if (source === null) {
        this.name.set('');
        this.email.set('');
        this.organisation.set('');
        this.password.set(crypto.randomUUID().replace(/-/g, '').slice(0, 20) + '7a');
        this.plan.set('starter');
        return;
      }

      this.name.set(source.name);
      this.email.set(source.email);
      this.organisation.set(source.organisation);
      this.plan.set(source.plan);
      this.password.set('');
    });
  }

  protected submit(): void {
    if (this.invalid() || this.saving()) {
      return;
    }

    this.save.emit({
      name: this.name().trim(),
      email: this.email().trim(),
      organisation: this.organisation().trim(),
      password: this.password(),
      plan: this.plan(),
    });
  }
}
