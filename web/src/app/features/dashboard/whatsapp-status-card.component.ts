import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import {
  HEALTH_LABEL,
  accountHealth,
  type AccountHealthLevel,
  type WhatsAppAccount,
} from '@core/models/whatsapp-account.model';
import { WhatsAppContextService } from '@core/services/whatsapp-context.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { WhatsAppHealthComponent } from '@shared/ui/whatsapp-health/whatsapp-health.component';

const LEVEL_ORDER: Readonly<Record<AccountHealthLevel, number>> = { down: 0, attention: 1, healthy: 2 };

/**
 * Every WhatsApp number at a glance, worst first.
 *
 * Sorted by health so a broken number is the first thing on the dashboard
 * rather than the third row down. Each row carries its most important reason
 * and when Meta was last heard from — "connected" alone says nothing about
 * whether messages are actually flowing.
 */
@Component({
  selector: 'app-whatsapp-status-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TimeAgoPipe, CardComponent, IconComponent, WhatsAppHealthComponent],
  template: `
    @if (rows().length > 0) {
      <app-card [padded]="false">
        <div class="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-ink">WhatsApp numbers</h2>
            <p class="mt-0.5 text-xs text-ink-muted">{{ summary() }}</p>
          </div>
          <a
            [routerLink]="manageRoute()"
            class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            Manage
            <app-icon name="chevronRight" [size]="13" />
          </a>
        </div>

        <ul class="divide-y divide-line/70">
          @for (row of rows(); track row.account.id) {
            <li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <div class="flex min-w-0 flex-1 items-center gap-2.5">
                <app-whatsapp-health [account]="row.account" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-ink">
                    {{ row.account.label }}
                    <span class="font-normal text-ink-muted">· {{ row.account.displayPhoneNumber }}</span>
                  </p>
                  @if (row.reason) {
                    <p class="truncate text-xs" [class]="row.level === 'down' ? 'text-red-700' : 'text-amber-700'">
                      {{ row.reason }}
                    </p>
                  }
                </div>
              </div>
              <div class="flex items-center gap-4 text-xs text-ink-muted">
                <span [title]="'Last webhook from Meta'">
                  <app-icon name="clock" [size]="12" class="mr-0.5 inline" />
                  {{ row.account.health.lastWebhookAt === null ? 'No webhooks yet' : (row.account.health.lastWebhookAt | timeAgo) }}
                </span>
                <span
                  class="rounded-full px-2 py-0.5 font-medium"
                  [class]="
                    row.level === 'healthy'
                      ? 'bg-green-50 text-green-700'
                      : row.level === 'attention'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-red-50 text-red-700'
                  "
                >
                  {{ row.label }}
                </span>
              </div>
            </li>
          }
        </ul>
      </app-card>
    }
  `,
})
export class WhatsAppStatusCardComponent {
  private readonly context = inject(WhatsAppContextService);
  private readonly auth = inject(AuthService);

  protected readonly manageRoute = computed(() => (this.auth.isSuperAdmin() ? '/superadmin/whatsapp' : '/whatsapp'));

  protected readonly rows = computed(() =>
    this.context
      .accounts()
      .map((account: WhatsAppAccount) => {
        const verdict = accountHealth(account);
        return {
          account,
          level: verdict.level,
          label: account.status === 'connected' && verdict.level === 'healthy' ? 'Connected' : HEALTH_LABEL[verdict.level],
          reason: verdict.reasons[0] ?? null,
        };
      })
      .sort((left, right) => LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level]),
  );

  protected readonly summary = computed(() => {
    const rows = this.rows();
    const down = rows.filter((row) => row.level === 'down').length;
    const attention = rows.filter((row) => row.level === 'attention').length;
    if (down === 0 && attention === 0) {
      return `All ${rows.length} ${rows.length === 1 ? 'number is' : 'numbers are'} healthy`;
    }
    const parts = [
      down > 0 ? `${down} down` : null,
      attention > 0 ? `${attention} need${attention === 1 ? 's' : ''} attention` : null,
    ].filter((part): part is string => part !== null);
    return `${parts.join(', ')} of ${rows.length}`;
  });
}
