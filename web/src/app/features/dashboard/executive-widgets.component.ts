import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import type { WhatsAppConnection } from '@core/models/whatsapp.model';
import { EntitlementService, type UsageView } from '@core/services/entitlement.service';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';
import { ProgressRingComponent, type RingTone } from '@shared/ui/progress-ring/progress-ring.component';

export interface AllowanceWidget {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  /** Percentage of the allowance still available. */
  readonly remainingPercent: number;
  readonly remainingText: string;
  readonly detail: string;
  readonly tone: RingTone;
  readonly badgeTone: BadgeTone;
  readonly badgeText: string;
  readonly actionLabel: string;
  readonly actionRoute: string;
}

/**
 * Executive strip on the dashboard: subscription health, channel connection and
 * how much of each allowance is left, each with a one-click next step.
 */
@Component({
  selector: 'app-executive-widgets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
    ProgressRingComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
  ],
  templateUrl: './executive-widgets.component.html',
})
export class ExecutiveWidgetsComponent {
  readonly connection = input<WhatsAppConnection | null>(null);

  private readonly entitlements = inject(EntitlementService);

  protected readonly planName = this.entitlements.planName;
  protected readonly subscription = this.entitlements.subscription;
  protected readonly daysRemaining = this.entitlements.daysRemaining;

  /** Days left as a share of a 30-day cycle, for the ring. */
  protected readonly daysPercent = computed(() =>
    Math.min(100, Math.round((this.daysRemaining() / 30) * 100)),
  );

  protected readonly daysTone = computed<RingTone>(() => {
    const days = this.daysRemaining();
    if (days <= 7) {
      return 'danger';
    }
    return days <= 14 ? 'warning' : 'brand';
  });

  protected readonly subscriptionBadge = computed<{ tone: BadgeTone; text: string }>(() => {
    const status = this.subscription()?.status ?? null;
    if (status === null) {
      return { tone: 'neutral', text: 'No plan' };
    }
    if (status === 'trial') {
      return { tone: 'info', text: 'Trial' };
    }
    if (status !== 'active') {
      return { tone: 'danger', text: status };
    }
    return this.daysRemaining() <= 14
      ? { tone: 'warning', text: 'Renews soon' }
      : { tone: 'success', text: 'Active' };
  });

  protected readonly isConnected = computed(() => this.connection()?.status === 'connected');

  protected readonly metaBadge = computed<{ tone: BadgeTone; text: string }>(() => {
    const connection = this.connection();
    if (connection === null || connection.status !== 'connected') {
      return { tone: 'danger', text: 'Disconnected' };
    }
    if (!connection.webhookHealthy) {
      return { tone: 'warning', text: 'Webhook issue' };
    }
    const quality = connection.qualityRating;
    return quality === 'green'
      ? { tone: 'success', text: 'Healthy' }
      : quality === 'yellow'
        ? { tone: 'warning', text: 'Medium quality' }
        : { tone: 'danger', text: 'Low quality' };
  });

  /** Remaining-allowance widgets, built from live usage. */
  protected readonly allowances = computed<readonly AllowanceWidget[]>(() => {
    const specs: readonly {
      key: Parameters<EntitlementService['usageFor']>[0];
      label: string;
      icon: IconName;
      action: string;
      route: string;
    }[] = [
      { key: 'campaigns', label: 'Campaign credits', icon: 'megaphone', action: 'Buy credits', route: '/pricing' },
      { key: 'contacts', label: 'Contact limit', icon: 'users', action: 'Upgrade plan', route: '/pricing' },
      { key: 'employees', label: 'Employee seats', icon: 'userGroup', action: 'Add seats', route: '/pricing' },
      { key: 'apiCalls', label: 'API requests', icon: 'command', action: 'Raise limit', route: '/pricing' },
      { key: 'storage', label: 'Storage', icon: 'database', action: 'Add storage', route: '/pricing' },
    ];

    return specs.flatMap((spec) => {
      const metric = this.entitlements.usageFor(spec.key);
      if (metric === null) {
        return [];
      }

      const remainingPercent = metric.unlimited ? 100 : 100 - metric.percent;
      const tone: RingTone = metric.unlimited
        ? 'brand'
        : remainingPercent <= 10
          ? 'danger'
          : remainingPercent <= 25
            ? 'warning'
            : 'brand';

      const badge = this.badgeFor(metric, remainingPercent);

      return [
        {
          key: spec.key,
          label: spec.label,
          icon: spec.icon,
          remainingPercent,
          remainingText: metric.unlimited
            ? '∞'
            : `${(metric.remaining ?? 0).toLocaleString()}`,
          detail: metric.unlimited
            ? `${metric.used.toLocaleString()} ${metric.unit} used`
            : `of ${(metric.limit ?? 0).toLocaleString()} ${metric.unit}`,
          tone,
          badgeTone: badge.tone,
          badgeText: badge.text,
          actionLabel: spec.action,
          actionRoute: spec.route,
        },
      ];
    });
  });

  private badgeFor(metric: UsageView, remainingPercent: number): { tone: BadgeTone; text: string } {
    if (metric.unlimited) {
      return { tone: 'brand', text: 'Unlimited' };
    }
    if (metric.severity === 'exceeded') {
      return { tone: 'danger', text: 'Limit reached' };
    }
    if (remainingPercent <= 10) {
      return { tone: 'danger', text: 'Critical' };
    }
    return remainingPercent <= 25
      ? { tone: 'warning', text: 'Running low' }
      : { tone: 'success', text: 'Healthy' };
  }
}
