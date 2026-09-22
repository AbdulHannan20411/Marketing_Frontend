import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError } from '@core/models/api.model';
import { MESSAGING_TIER_LABELS } from '@core/models/whatsapp.model';
import {
  accountHealth,
  atAccountLimit,
  type WhatsAppAccount,
} from '@core/models/whatsapp-account.model';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppAccountsService } from '@core/services/whatsapp-accounts.service';
import { WhatsAppContextService } from '@core/services/whatsapp-context.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { HistoryButtonComponent } from '@shared/audit/history-button.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { WhatsAppHealthComponent } from '@shared/ui/whatsapp-health/whatsapp-health.component';

type Confirming = { readonly kind: 'disconnect' | 'remove'; readonly account: WhatsAppAccount };

/**
 * Every WhatsApp number in the workspace: health, plan usage, and management.
 *
 * Doubles as the troubleshooting view. Each card lists when the number last
 * heard from Meta and last sent or received, because "connected" on its own
 * says nothing about whether messages are actually flowing.
 *
 * Connecting a new number is the parent page's job — it owns the Meta popup
 * and the onboarding progress — so this only asks for it.
 */
@Component({
  selector: 'app-whatsapp-accounts-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HistoryButtonComponent, RouterLink, TimeAgoPipe, ButtonDirective, IconComponent, ModalComponent, WhatsAppHealthComponent],
  templateUrl: './whatsapp-accounts-panel.component.html',
})
export class WhatsAppAccountsPanelComponent {
  protected readonly context = inject(WhatsAppContextService);
  private readonly service = inject(WhatsAppAccountsService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  /** Asks the page to run Embedded Signup for an additional number. */
  readonly connectAnother = output<void>();

  protected readonly tierLabels = MESSAGING_TIER_LABELS;

  protected readonly canManage = computed(() => this.auth.hasPermission('whatsapp.connect'));
  protected readonly canRemove = computed(() => this.auth.hasPermission('whatsapp.disconnect'));

  protected readonly list = this.context.list;

  protected readonly atLimit = computed(() => {
    const list = this.list();
    return list !== null && atAccountLimit(list);
  });

  protected readonly usagePercent = computed(() => {
    const list = this.list();
    if (list === null || list.limit === null || list.limit === 0) {
      return 0;
    }
    return Math.min(100, Math.round((list.used / list.limit) * 100));
  });

  /** Only worth a whole panel once there is something to compare. */
  protected readonly show = computed(() => this.context.accounts().length > 0);

  protected readonly busyId = signal<string | null>(null);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly renameValue = signal('');
  protected readonly renameError = signal<string | null>(null);
  protected readonly confirming = signal<Confirming | null>(null);

  protected problems(account: WhatsAppAccount): readonly string[] {
    return accountHealth(account).reasons;
  }

  protected isSelected(account: WhatsAppAccount): boolean {
    return this.context.selectedAccountId() === account.id;
  }

  protected open(account: WhatsAppAccount): void {
    this.context.select(account.id);
  }

  /* ------------------------------ rename ------------------------------ */

  protected startRename(account: WhatsAppAccount): void {
    this.renamingId.set(account.id);
    this.renameValue.set(account.label);
    this.renameError.set(null);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
    this.renameError.set(null);
  }

  protected saveRename(account: WhatsAppAccount): void {
    const label = this.renameValue().trim();
    if (label === account.label) {
      this.cancelRename();
      return;
    }
    if (label === '' || label.length > 40) {
      this.renameError.set('Use a name of 1 to 40 characters.');
      return;
    }

    this.busyId.set(account.id);
    this.service.rename(account.id, label).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.context.replace(updated);
        this.renamingId.set(null);
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        // Shown beside the field: the fix is to type something else, right there.
        this.renameError.set(
          error.errorCode === 'whatsapp_label_taken'
            ? error.detail
            : (error.fieldErrors['label']?.[0] ?? 'Could not rename this number.'),
        );
      },
    });
  }

  /* ------------------------------ actions ------------------------------ */

  protected makeDefault(account: WhatsAppAccount): void {
    this.busyId.set(account.id);
    this.service.setDefault(account.id).subscribe({
      next: (accounts) => {
        this.busyId.set(null);
        this.context.replaceAll(accounts);
        this.toast.success('Default number changed', `New work uses ${account.label} unless someone picks another.`);
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected refresh(account: WhatsAppAccount): void {
    this.busyId.set(account.id);
    this.service.sync(account.id).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.context.replace(updated);
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected confirm(kind: Confirming['kind'], account: WhatsAppAccount): void {
    this.confirming.set({ kind, account });
  }

  protected proceed(): void {
    const target = this.confirming();
    if (target === null) {
      return;
    }
    const { kind, account } = target;
    this.busyId.set(account.id);

    if (kind === 'disconnect') {
      this.service.disconnect(account.id).subscribe({
        next: () => {
          this.busyId.set(null);
          this.confirming.set(null);
          // Reloaded rather than patched: the default may have moved to another number.
          this.context.load();
          this.toast.success(`${account.label} disconnected`, 'Its conversations and assignments are kept.');
        },
        error: (error: ApiError) => {
          this.busyId.set(null);
          this.toast.error(error.title, error.detail);
        },
      });
      return;
    }

    this.service.remove(account.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.confirming.set(null);
        this.context.load();
        this.toast.success(`${account.label} removed`, 'The slot on your plan is free again.');
      },
      error: (error: ApiError) => {
        this.busyId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected tokenLabel(account: WhatsAppAccount): string {
    if (account.tokenExpiresAt === null) {
      return 'No expiry';
    }
    const days = Math.ceil((new Date(account.tokenExpiresAt).getTime() - Date.now()) / 86_400_000);
    if (days <= 0) {
      return 'Expired';
    }
    return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
  }
}
