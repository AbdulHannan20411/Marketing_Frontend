import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { FEATURE_MODULE_LABEL, type FeatureModule } from '@core/models/permission.model';
import { EntitlementService } from '@core/services/entitlement.service';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { UpgradePromptComponent } from '@shared/ui/upgrade-prompt/upgrade-prompt.component';

/** Landing page the `featureGuard` redirects to when a module is not in the plan. */
@Component({
  selector: 'app-upgrade',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, UpgradePromptComponent],
  template: `
    <app-page-header
      title="Upgrade required"
      [description]="'This area needs a plan that includes ' + moduleLabel() + '.'"
      [breadcrumbs]="[{ label: 'Home', route: '/dashboard' }, { label: 'Upgrade', route: null }]"
    />

    <div class="mx-auto mt-8 max-w-2xl">
      <app-upgrade-prompt
        [title]="moduleLabel() + ' is not in your plan'"
        [description]="
          'Your current plan does not include ' +
          moduleLabel() +
          '. Upgrade to unlock it — everything you have already set up stays exactly as it is.'
        "
        iconName="lock"
        recommendedPlan="Scale"
        ctaLabel="See plans"
      />
    </div>
  `,
})
export class UpgradeComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly entitlements = inject(EntitlementService);

  private readonly params = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly moduleLabel = computed(() => {
    const module = this.params()?.get('module') as FeatureModule | null;
    return module === null ? 'this module' : FEATURE_MODULE_LABEL[module];
  });

  protected readonly planName = this.entitlements.planName;
}
