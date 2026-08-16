import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  FEATURE_MODULES,
  FEATURE_MODULE_LABEL,
  type FeatureModule,
} from '@core/models/permission.model';
import type {
  PlanLimits,
  PlanModules,
  PlanStatus,
  SubscriptionPlan,
  SupportLevel,
} from '@core/models/subscription.model';
import type { PlanDraft } from '@core/services/plan-admin.service';
import { PositiveNumberDirective } from '@shared/directives/positive-number.directive';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ToggleComponent } from '@shared/ui/toggle/toggle.component';

interface LimitField {
  readonly key: keyof PlanLimits;
  readonly label: string;
  readonly hint: string;
}

const LIMIT_FIELDS: readonly LimitField[] = [
  { key: 'maxEmployees', label: 'Max employees', hint: 'Seats included' },
  { key: 'maxContacts', label: 'Max contacts', hint: 'Stored contacts' },
  { key: 'maxCampaigns', label: 'Max campaigns', hint: 'Per billing cycle' },
  { key: 'maxWhatsAppAccounts', label: 'Max WhatsApp accounts', hint: 'Connected numbers' },
  { key: 'maxEmailAccounts', label: 'Max email accounts', hint: 'Sending identities' },
  { key: 'maxSocialAccounts', label: 'Max social accounts', hint: 'Connected profiles' },
  { key: 'maxApiCallsPerMonth', label: 'Max API calls', hint: 'Requests per month' },
  { key: 'maxStorageMb', label: 'Max storage (MB)', hint: 'Media and exports' },
  { key: 'dailyMessageLimit', label: 'Daily message limit', hint: 'Rolling 24 hours' },
  { key: 'monthlyMessageLimit', label: 'Monthly message limit', hint: 'Per billing cycle' },
];

const EMPTY_LIMITS: PlanLimits = {
  maxEmployees: 5,
  maxContacts: 5_000,
  maxCampaigns: 25,
  maxWhatsAppAccounts: 1,
  maxEmailAccounts: 1,
  maxSocialAccounts: 0,
  maxApiCallsPerMonth: 10_000,
  maxStorageMb: 5_120,
  dailyMessageLimit: 2_000,
  monthlyMessageLimit: 50_000,
};

const EMPTY_MODULES: PlanModules = {
  whatsapp: true,
  email: false,
  social: false,
  crm: true,
  reporting: false,
  ai: false,
  api: false,
  employees: false,
};

/**
 * Create/edit dialog for a subscription plan.
 *
 * Edits a local working copy and only emits on save, so cancelling leaves the
 * caller's plan untouched. A `null` limit means unlimited, toggled per field.
 */
@Component({
  selector: 'app-plan-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ModalComponent,
    ToggleComponent,
    ButtonDirective,
    IconComponent,
    PositiveNumberDirective,
  ],
  templateUrl: './plan-editor.component.html',
})
export class PlanEditorComponent {
  /** `null` opens the dialog in create mode. */
  readonly plan = input<SubscriptionPlan | null>(null);

  readonly save = output<PlanDraft>();
  readonly cancel = output<void>();

  protected readonly limitFields = LIMIT_FIELDS;
  protected readonly moduleKeys = FEATURE_MODULES;
  protected readonly moduleLabel = FEATURE_MODULE_LABEL;

  protected readonly name = signal('');
  protected readonly tagline = signal('');
  protected readonly monthlyPrice = signal(0);
  protected readonly yearlyPrice = signal(0);
  protected readonly trialDays = signal(14);
  protected readonly renewalPeriodMonths = signal(1);
  protected readonly discountPercent = signal(0);
  protected readonly isPromotional = signal(false);
  protected readonly isMostPopular = signal(false);
  protected readonly isRecommended = signal(false);
  protected readonly status = signal<PlanStatus>('active');
  protected readonly supportLevel = signal<SupportLevel>('email');
  protected readonly modules = signal<PlanModules>({ ...EMPTY_MODULES });
  protected readonly limits = signal<PlanLimits>({ ...EMPTY_LIMITS });
  protected readonly highlightsText = signal('');

  protected readonly isEdit = computed(() => this.plan() !== null);
  protected readonly dialogTitle = computed(() =>
    this.isEdit() ? `Edit ${this.plan()?.name}` : 'Create subscription plan',
  );

  protected readonly nameInvalid = computed(() => this.name().trim().length === 0);

  protected readonly enabledModuleCount = computed(
    () => Object.values(this.modules()).filter(Boolean).length,
  );

  protected readonly statuses: readonly { value: PlanStatus; label: string }[] = [
    { value: 'active', label: 'Active — sellable' },
    { value: 'inactive', label: 'Inactive — hidden from pricing' },
    { value: 'archived', label: 'Archived — retained for history' },
  ];

  protected readonly supportLevels: readonly { value: SupportLevel; label: string }[] = [
    { value: 'community', label: 'Community' },
    { value: 'email', label: 'Email' },
    { value: 'priority', label: 'Priority' },
    { value: 'dedicated', label: 'Dedicated manager' },
  ];

  constructor() {
    // Re-seed the form whenever a different plan is passed in.
    effect(() => {
      const source = this.plan();
      if (source === null) {
        this.resetToDefaults();
        return;
      }

      this.name.set(source.name);
      this.tagline.set(source.tagline);
      this.monthlyPrice.set(source.monthlyPrice);
      this.yearlyPrice.set(source.yearlyPrice);
      this.trialDays.set(source.trialDays);
      this.renewalPeriodMonths.set(source.renewalPeriodMonths);
      this.discountPercent.set(source.discountPercent);
      this.isPromotional.set(source.isPromotional);
      this.isMostPopular.set(source.isMostPopular);
      this.isRecommended.set(source.isRecommended);
      this.status.set(source.status);
      this.supportLevel.set(source.supportLevel);
      this.modules.set({ ...source.modules });
      this.limits.set({ ...source.limits });
      this.highlightsText.set(source.highlights.join('\n'));
    });
  }

  protected moduleEnabled(key: FeatureModule): boolean {
    return this.modules()[key];
  }

  protected setModule(key: FeatureModule, enabled: boolean): void {
    this.modules.update((current) => ({ ...current, [key]: enabled }));
  }

  protected limitValue(key: keyof PlanLimits): number | null {
    return this.limits()[key];
  }

  protected isUnlimited(key: keyof PlanLimits): boolean {
    return this.limits()[key] === null;
  }

  protected setUnlimited(key: keyof PlanLimits, unlimited: boolean): void {
    this.limits.update((current) => ({ ...current, [key]: unlimited ? null : 0 }));
  }

  protected setLimit(key: keyof PlanLimits, raw: string): void {
    const parsed = Number(raw);
    this.limits.update((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0,
    }));
  }

  protected submit(): void {
    if (this.nameInvalid()) {
      return;
    }

    this.save.emit({
      name: this.name().trim(),
      tagline: this.tagline().trim(),
      monthlyPrice: this.monthlyPrice(),
      yearlyPrice: this.yearlyPrice(),
      currency: this.plan()?.currency ?? 'USD',
      trialDays: this.trialDays(),
      renewalPeriodMonths: this.renewalPeriodMonths(),
      discountPercent: this.discountPercent(),
      isPromotional: this.isPromotional(),
      isMostPopular: this.isMostPopular(),
      isRecommended: this.isRecommended(),
      status: this.status(),
      supportLevel: this.supportLevel(),
      modules: this.modules(),
      limits: this.limits(),
      highlights: this.highlightsText()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      sortOrder: this.plan()?.sortOrder ?? 99,
    });
  }

  private resetToDefaults(): void {
    this.name.set('');
    this.tagline.set('');
    this.monthlyPrice.set(0);
    this.yearlyPrice.set(0);
    this.trialDays.set(14);
    this.renewalPeriodMonths.set(1);
    this.discountPercent.set(0);
    this.isPromotional.set(false);
    this.isMostPopular.set(false);
    this.isRecommended.set(false);
    this.status.set('active');
    this.supportLevel.set('email');
    this.modules.set({ ...EMPTY_MODULES });
    this.limits.set({ ...EMPTY_LIMITS });
    this.highlightsText.set('');
  }
}
