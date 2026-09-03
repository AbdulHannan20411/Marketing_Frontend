import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { WhatsAppConnection } from '@core/models/whatsapp.model';
import { connectionExpiry } from '@core/models/whatsapp.model';
import { IconComponent } from '@shared/ui/icon/icon.component';

/**
 * Warns that the WhatsApp credential is running out, while there is still time
 * to do something about it.
 *
 * An Embedded Signup token has a finite life. Once it lapses the API reports
 * `status: 'error'` and campaigns fail with an opaque `401` — indistinguishable,
 * at that point, from a revoked permission. This is the window before that:
 * reconnecting is a two-minute job right up until it isn't.
 *
 * Shared rather than written per screen so the threshold and the wording cannot
 * drift between the WhatsApp page, the dashboard and the campaign form — three
 * places saying slightly different things about the same date is worse than one
 * place saying it.
 */
@Component({
  selector: 'app-connection-expiry-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    @if (expiry(); as detail) {
      <div
        role="status"
        class="flex flex-wrap items-start gap-3 rounded-xl px-4 py-3.5 ring-1"
        [class]="tone()"
      >
        <app-icon
          name="warning"
          [size]="17"
          class="mt-px shrink-0"
          [class.text-danger]="detail.urgency === 'urgent'"
          [class.text-warning]="detail.urgency !== 'urgent'"
        />

        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium" [class]="headingTone()">
            Your WhatsApp connection {{ detail.phrase }}
          </p>
          <p class="mt-0.5 text-sm leading-relaxed" [class]="bodyTone()">
            Reconnect to avoid interruption. Campaigns stop sending the moment it lapses.
          </p>
        </div>

        <!-- Omitted on the WhatsApp page itself: a link to the page you are
             already on is a dead end where the action should be. -->
        @if (showAction()) {
          <a
            routerLink="/whatsapp"
            class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition-colors"
            [class]="actionTone()"
          >
            Reconnect
          </a>
        }
      </div>
    }
  `,
})
export class ConnectionExpiryNoticeComponent {
  readonly connection = input<WhatsAppConnection | null>(null);

  /**
   * Whether to offer the link through to the WhatsApp screen.
   *
   * Off on that screen itself, where the reconnect controls are already in
   * view a few hundred pixels below.
   */
  readonly showAction = input(true);

  protected readonly expiry = computed(() => {
    const connection = this.connection();
    if (connection === null) {
      return null;
    }

    // A connection that is already broken has its own, louder treatment. Two
    // warnings about the same thing read as two problems.
    if (connection.status !== 'connected') {
      return null;
    }
    return connectionExpiry(connection.tokenExpiresAt);
  });

  private readonly urgent = computed(() => this.expiry()?.urgency === 'urgent');

  protected readonly tone = computed(() =>
    this.urgent() ? 'bg-red-50 ring-red-200' : 'bg-amber-50 ring-amber-200',
  );

  protected readonly headingTone = computed(() =>
    this.urgent() ? 'text-red-900' : 'text-amber-900',
  );

  protected readonly bodyTone = computed(() =>
    this.urgent() ? 'text-red-900/80' : 'text-amber-900/80',
  );

  protected readonly actionTone = computed(() =>
    this.urgent()
      ? 'bg-surface text-red-900 ring-red-200 hover:bg-red-100'
      : 'bg-surface text-amber-900 ring-amber-200 hover:bg-amber-100',
  );
}
