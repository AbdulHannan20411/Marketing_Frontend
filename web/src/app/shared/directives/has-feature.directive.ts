import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  input,
} from '@angular/core';

import type { FeatureModule } from '@core/models/permission.model';
import { EntitlementService } from '@core/services/entitlement.service';

/**
 * Renders content only when the current plan includes the module.
 *
 *   <a *appHasFeature="'email'" routerLink="/email">Email marketing</a>
 *
 * Use `appHasFeatureElse` to show an upgrade prompt in its place.
 */
@Directive({ selector: '[appHasFeature]' })
export class HasFeatureDirective {
  readonly appHasFeature = input.required<FeatureModule>();
  readonly appHasFeatureElse = input<TemplateRef<unknown> | null>(null);

  private readonly entitlements = inject(EntitlementService);
  private readonly template = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly viewContainer = inject(ViewContainerRef);
  private shown: 'main' | 'fallback' | null = null;

  constructor() {
    effect(() => {
      const enabled = this.entitlements.hasFeature(this.appHasFeature());
      const fallback = this.appHasFeatureElse();
      const target = enabled ? 'main' : fallback === null ? null : 'fallback';

      if (target === this.shown) {
        return;
      }

      this.viewContainer.clear();
      if (target === 'main') {
        this.viewContainer.createEmbeddedView(this.template);
      } else if (target === 'fallback' && fallback !== null) {
        this.viewContainer.createEmbeddedView(fallback);
      }
      this.shown = target;
    });
  }
}
