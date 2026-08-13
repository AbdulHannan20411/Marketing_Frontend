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
  /** Edit only. Creation lands on the default band; the owner picks their own. */
  readonly plan: TenantPlan | null;
}

const PLANS: readonly TenantPlan[] = ['starter', 'growth', 'scale', 'enterprise'];

/**
 * Create or edit an Admin account.
 *
 * Creation takes name, email and organisation and nothing else: the API emails
 * an invitation, the owner sets their own password when they accept, and the
 * organisation chooses its plan once they are in. The plan band stays editable
 * here afterwards as a platform-side override. On edit the email is fixed —
 * the API has no route for changing it.
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
  protected readonly plan = signal<TenantPlan>('starter');

  protected readonly isEdit = computed(() => this.admin() !== null);

  protected readonly title = computed(() =>
    this.isEdit() ? `Edit ${this.admin()?.organisation}` : 'Create admin account',
  );

  protected readonly subtitle = computed(() =>
    this.isEdit()
      ? 'Update the organisation name, contact name and plan band.'
      : 'Creates the organisation and invites its first administrator by email.',
  );

  protected readonly nameInvalid = computed(() => this.name().trim().length === 0);
  protected readonly orgInvalid = computed(() => this.organisation().trim().length === 0);

  protected readonly emailInvalid = computed(
    () => !this.isEdit() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim()),
  );

  protected readonly invalid = computed(
    () => this.nameInvalid() || this.orgInvalid() || this.emailInvalid(),
  );

  constructor() {
    effect(() => {
      const source = this.admin();
      if (source === null) {
        this.name.set('');
        this.email.set('');
        this.organisation.set('');
        this.plan.set('starter');
        return;
      }

      this.name.set(source.name);
      this.email.set(source.email);
      this.organisation.set(source.organisation);
      this.plan.set(source.plan);
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
      plan: this.isEdit() ? this.plan() : null,
    });
  }
}
