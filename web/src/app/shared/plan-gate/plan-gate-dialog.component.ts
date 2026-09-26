import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { EntitlementService } from '@core/services/entitlement.service';
import { PlanGateService } from '@core/services/plan-gate.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/** What each module is called when it has to be named in a sentence. */
const MODULE_LABEL: Readonly<Record<string, string>> = {
  crm: 'Contacts, groups and tags',
  whatsapp: 'WhatsApp campaigns and templates',
  reporting: 'Reports and analytics',
  ai: 'The AI assistant',
  email: 'Email campaigns',
  social: 'Social channels',
};

/**
 * The offer that appears when an action needs a plan the workspace does not
 * have.
 *
 * Rendered once, by the shell, and driven by `PlanGateService` — so every
 * gated action anywhere in the product produces the same dialog rather than
 * each screen inventing its own message.
 *
 * Two versions of the same idea: **Purchase** when there is no usable
 * subscription, **Upgrade** when there is one and it does not include this.
 * The difference matters: telling somebody who is already paying to "buy a
 * plan" reads as though their money went nowhere.
 */
@Component({
  selector: 'app-plan-gate-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonDirective, IconComponent],
  host: { class: 'contents' },
  template: `
    @if (gate.prompt(); as request) {
      <app-modal [title]="title()" [subtitle]="subtitle()" size="sm" (closed)="gate.dismiss()">
        <div class="flex items-start gap-3">
          <span
            class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"
          >
            <app-icon name="rocket" [size]="20" />
          </span>
          <div class="min-w-0">
            <p class="text-sm leading-relaxed text-ink-soft">{{ body() }}</p>
            @if (planName(); as plan) {
              <p class="mt-2 text-xs text-ink-muted">
                Your current plan: <span class="font-medium text-ink">{{ plan }}</span>
              </p>
            }
          </div>
        </div>

        <!-- What stays available regardless, so the dialog is not only a wall. -->
        <p class="mt-4 rounded-lg bg-surface-sunken px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
          You can keep looking around — every screen stays readable. Only changes need the plan.
        </p>

        <ng-container modalFooter>
          <button appButton variant="ghost" size="md" (click)="gate.dismiss()">Not now</button>
          <button appButton size="md" (click)="seePlans()">
            <app-icon name="rocket" [size]="15" />
            {{ request.reason === 'purchase' ? 'Purchase a plan' : 'Upgrade plan' }}
          </button>
        </ng-container>
      </app-modal>
    }
  `,
})
export class PlanGateDialogComponent {
  protected readonly gate = inject(PlanGateService);
  private readonly entitlements = inject(EntitlementService);
  private readonly router = inject(Router);

  protected readonly planName = computed(() =>
    this.gate.prompt()?.reason === 'upgrade' ? this.entitlements.planName() : null,
  );

  protected readonly title = computed(() =>
    this.gate.prompt()?.reason === 'purchase'
      ? 'Purchase a plan to make changes'
      : 'Your plan does not include this yet',
  );

  /** The action, when the client stopped it. Absent for the API's own refusal. */
  protected readonly subtitle = computed(() => this.gate.prompt()?.action ?? null);

  protected readonly body = computed(() => {
    const request = this.gate.prompt();
    if (request === null) {
      return '';
    }

    const feature = request.module === null ? null : (MODULE_LABEL[request.module] ?? null);

    if (request.reason === 'purchase') {
      return this.entitlements.lockReason() === 'none'
        ? 'This workspace has no plan yet, so nothing can be created or changed. Choosing one takes a minute and everything starts working straight away.'
        : 'This workspace has no active plan, so nothing can be created or changed. Your data is exactly as you left it and comes back the moment a plan is active.';
    }

    return feature === null
      ? 'This is part of a higher plan. Upgrading unlocks it immediately — nothing has to be set up again.'
      : `${feature} are part of a higher plan. Upgrading unlocks them immediately — nothing has to be set up again.`;
  });

  protected seePlans(): void {
    this.gate.dismiss();
    void this.router.navigate(['/pricing']);
  }
}
