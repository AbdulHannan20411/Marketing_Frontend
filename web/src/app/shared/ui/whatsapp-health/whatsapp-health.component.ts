import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  HEALTH_LABEL,
  accountHealth,
  type AccountHealthLevel,
  type WhatsAppAccount,
} from '@core/models/whatsapp-account.model';

const DOT: Readonly<Record<AccountHealthLevel, string>> = {
  healthy: 'bg-green-500',
  attention: 'bg-amber-500',
  down: 'bg-red-500',
};

const TEXT: Readonly<Record<AccountHealthLevel, string>> = {
  healthy: 'text-green-700',
  attention: 'text-amber-700',
  down: 'text-red-700',
};

/**
 * The traffic light for one WhatsApp number.
 *
 * Colour is never the only signal: the label is always in the accessible name,
 * and shown on screen when `showLabel` is set. The reasons go in the tooltip,
 * because "amber" alone tells an admin nothing they can act on.
 */
@Component({
  selector: 'app-whatsapp-health',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5' },
  template: `
    <span
      class="relative inline-flex h-2 w-2 shrink-0 rounded-full"
      [class]="dotClass()"
      role="img"
      [attr.aria-label]="accessibleLabel()"
      [attr.title]="tooltip()"
    >
      @if (verdict().level === 'down') {
        <span class="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-60"></span>
      }
    </span>
    @if (showLabel()) {
      <span class="text-xs font-medium" [class]="textClass()">{{ label() }}</span>
    }
  `,
})
export class WhatsAppHealthComponent {
  readonly account = input.required<WhatsAppAccount>();
  readonly showLabel = input(false);

  protected readonly verdict = computed(() => accountHealth(this.account()));
  protected readonly label = computed(() => HEALTH_LABEL[this.verdict().level]);
  protected readonly dotClass = computed(() => DOT[this.verdict().level]);
  protected readonly textClass = computed(() => TEXT[this.verdict().level]);

  protected readonly tooltip = computed(() => {
    const { reasons } = this.verdict();
    return reasons.length === 0 ? this.label() : `${this.label()}: ${reasons.join('; ')}`;
  });

  protected readonly accessibleLabel = computed(() => `${this.account().label}: ${this.tooltip()}`);
}
