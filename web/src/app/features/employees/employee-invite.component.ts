import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import type { PermissionSet } from '@core/models/employee.model';
import { environment } from '@env/environment';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

export interface InviteDraft {
  readonly name: string;
  readonly email: string;
  readonly jobTitle: string;
  readonly role: 'Admin' | 'Employee';
  /** Empty means "no access yet" — set it in the matrix afterwards. */
  readonly permissionSetId: string;
}

/**
 * Invite someone into this workspace.
 *
 * The invitation is delivered by the platform's mail server, not the admin's,
 * so the recipient sees a NextReach address in the From line. That would look
 * like a stranger's email without context, so the screen states plainly how it
 * will be attributed — and the same wording is what the backend must put in the
 * subject and body.
 */
@Component({
  selector: 'app-employee-invite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonDirective, IconComponent],
  templateUrl: './employee-invite.component.html',
})
export class EmployeeInviteComponent {
  readonly permissionSets = input.required<readonly PermissionSet[]>();
  readonly saving = input(false);
  /** Remaining seats, or `null` when the plan is unlimited. */
  readonly seatsLeft = input<number | null>(null);

  readonly invited = output<InviteDraft>();
  readonly cancelled = output<void>();

  private readonly auth = inject(AuthService);

  protected readonly appName = environment.appName;

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly jobTitle = signal('');
  protected readonly role = signal<'Admin' | 'Employee'>('Employee');
  protected readonly permissionSetId = signal('');

  /** Who the invitation will say it is from. */
  protected readonly senderName = computed(() => this.auth.user()?.name ?? 'your workspace');
  protected readonly workspace = computed(
    () => this.auth.user()?.workspaceName ?? 'your workspace',
  );

  protected readonly nameInvalid = computed(() => this.name().trim().length === 0);
  protected readonly emailInvalid = computed(
    () => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim()),
  );

  protected readonly invalid = computed(() => this.nameInvalid() || this.emailInvalid());

  protected readonly selectedSet = computed(() =>
    this.permissionSets().find((set) => set.id === this.permissionSetId()) ?? null,
  );

  /** A co-admin holds everything, so a starting set would be meaningless. */
  protected readonly isCoAdmin = computed(() => this.role() === 'Admin');

  protected setRole(role: 'Admin' | 'Employee'): void {
    this.role.set(role);
    if (role === 'Admin') {
      this.permissionSetId.set('');
    }
  }

  protected submit(): void {
    if (this.invalid() || this.saving()) {
      return;
    }

    this.invited.emit({
      name: this.name().trim(),
      email: this.email().trim(),
      jobTitle: this.jobTitle().trim(),
      role: this.role(),
      permissionSetId: this.permissionSetId(),
    });
  }
}
