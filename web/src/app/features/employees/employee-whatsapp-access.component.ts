import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';

import type { ApiError } from '@core/models/api.model';
import type { Employee } from '@core/models/employee.model';
import {
  WHATSAPP_ACCESS_PERMISSIONS,
  accessProblems,
  type WhatsAppAccessUpdate,
} from '@core/models/whatsapp-account.model';
import { EmployeesService } from '@core/services/employees.service';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppContextService } from '@core/services/whatsapp-context.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { WhatsAppAccessEditorComponent } from './whatsapp-access-editor.component';

const EMPTY: WhatsAppAccessUpdate = { access: [], defaultAccountId: null };

/**
 * Per-number access for the employee chosen on the Access tab.
 *
 * Saved on its own, separately from the permission matrix below it: they are
 * different endpoints, and an admin adjusting one number should not have to
 * save — or discard — unrelated permission edits to do it.
 *
 * Administrators are not editable here. They always have every number, and
 * the API refuses to store rows for them.
 */
@Component({
  selector: 'app-employee-whatsapp-access',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent, ButtonDirective, IconComponent, WhatsAppAccessEditorComponent],
  template: `
    <app-card title="WhatsApp numbers" subtitle="Which numbers this person works on, and what they may do on each.">
      @if (employee().role !== 'Employee') {
        <p class="flex items-start gap-2 text-sm text-ink-soft">
          <app-icon name="info" [size]="16" class="mt-px shrink-0 text-info" />
          Administrators have full access to every WhatsApp number.
        </p>
      } @else {
        <app-whatsapp-access-editor
          [accounts]="context.accounts()"
          [value]="draft()"
          [disabled]="saving()"
          (valueChange)="draft.set($event)"
        />

        @if (context.accounts().length > 0) {
          <div class="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
            <span class="mr-auto text-xs text-ink-muted">{{ summary() }}</span>
            @if (dirty()) {
              <button appButton variant="ghost" size="sm" (click)="discard()">Discard</button>
            }
            <button appButton size="sm" [disabled]="!canSave()" (click)="save()">
              <app-icon name="checkCircle" [size]="14" />
              {{ saving() ? 'Saving…' : 'Save access' }}
            </button>
          </div>
        }
      }
    </app-card>
  `,
})
export class EmployeeWhatsAppAccessComponent {
  readonly employee = input.required<Employee>();
  /** The employee as saved, so the list beside this can update without a reload. */
  readonly updated = output<Employee>();

  protected readonly context = inject(WhatsAppContextService);
  private readonly employees = inject(EmployeesService);
  private readonly toast = inject(ToastService);

  protected readonly draft = signal<WhatsAppAccessUpdate>(EMPTY);
  protected readonly saving = signal(false);

  private readonly saved = computed<WhatsAppAccessUpdate>(() => {
    const employee = this.employee();
    return {
      access: employee.whatsAppAccess ?? [],
      defaultAccountId: employee.defaultWhatsAppAccountId ?? null,
    };
  });

  protected readonly dirty = computed(() => !sameAccess(this.saved(), this.draft()));

  protected readonly canSave = computed(
    () => this.dirty() && !this.saving() && accessProblems(this.draft()).length === 0,
  );

  protected readonly summary = computed(() => {
    const count = this.draft().access.length;
    return count === 0 ? 'No numbers — they see no WhatsApp conversations.' : `${count} of ${this.context.accounts().length} numbers`;
  });

  constructor() {
    // A different employee chosen in the picker starts from their saved access.
    effect(() => {
      const saved = this.saved();
      untracked(() => this.draft.set(saved));
    });
  }

  protected discard(): void {
    this.draft.set(this.saved());
  }

  protected save(): void {
    if (!this.canSave()) {
      return;
    }
    this.saving.set(true);

    this.employees.updateWhatsAppAccess(this.employee().id, this.draft()).subscribe({
      next: (employee) => {
        this.saving.set(false);
        this.updated.emit(employee);
        this.toast.success('WhatsApp access saved', `${employee.name}'s numbers are updated.`);
      },
      error: (error: ApiError) => {
        this.saving.set(false);
        const problem = Object.values(error.fieldErrors)[0]?.[0];
        this.toast.error(error.title, problem ?? error.detail);
      },
    });
  }
}

/** Order-insensitive: the same access listed in a different order is not a change. */
function sameAccess(left: WhatsAppAccessUpdate, right: WhatsAppAccessUpdate): boolean {
  if (left.defaultAccountId !== right.defaultAccountId || left.access.length !== right.access.length) {
    return false;
  }
  return left.access.every((row) => {
    const other = right.access.find((candidate) => candidate.accountId === row.accountId);
    return (
      other !== undefined &&
      WHATSAPP_ACCESS_PERMISSIONS.every(
        (permission) => row.permissions.includes(permission) === other.permissions.includes(permission),
      )
    );
  });
}
