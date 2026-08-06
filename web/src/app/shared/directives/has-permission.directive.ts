import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  input,
} from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import type { Permission } from '@core/models/permission.model';

/**
 * Renders content only when the user holds at least one of the given permissions.
 *
 *   <button *appHasPermission="'contacts.delete'">Delete</button>
 *   <div *appHasPermission="['reports.export', 'reports.download.csv']">…</div>
 *
 * Hiding an affordance is a usability measure, not a security boundary — the
 * API is still the authority on every write.
 */
@Directive({ selector: '[appHasPermission]' })
export class HasPermissionDirective {
  readonly appHasPermission = input.required<Permission | readonly Permission[]>();

  private readonly auth = inject(AuthService);
  private readonly template = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly viewContainer = inject(ViewContainerRef);
  private rendered = false;

  constructor() {
    effect(() => {
      const required = this.appHasPermission();
      const list = Array.isArray(required) ? required : [required as Permission];
      const granted = list.length === 0 || this.auth.hasAnyPermission(list);

      if (granted && !this.rendered) {
        this.viewContainer.createEmbeddedView(this.template);
        this.rendered = true;
      } else if (!granted && this.rendered) {
        this.viewContainer.clear();
        this.rendered = false;
      }
    });
  }
}
