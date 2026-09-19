import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import { WhatsAppContextService } from '@core/services/whatsapp-context.service';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { WhatsAppHealthComponent } from '@shared/ui/whatsapp-health/whatsapp-health.component';

/**
 * "Which WhatsApp number am I working on?" — in the top bar, on every page.
 *
 * Hidden with a single number: a selector with one entry is noise. Changing it
 * re-scopes the WhatsApp page, templates and the campaign builder's default;
 * the inbox keeps its own filter, because "every number I can see" is the
 * better starting point there.
 */
@Component({
  selector: 'app-whatsapp-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, WhatsAppHealthComponent],
  host: { class: 'relative', '(document:keydown.escape)': 'open.set(false)' },
  template: `
    @if (context.hasMultiple() && context.selectedAccount(); as current) {
      <button
        type="button"
        class="flex max-w-[16rem] items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ring-1 ring-line transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        aria-haspopup="listbox"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'WhatsApp number: ' + current.label + ', ' + current.displayPhoneNumber + '. Change number'"
        (click)="open.set(!open())"
      >
        <app-whatsapp-health [account]="current" />
        <span class="hidden text-xs text-ink-muted xl:inline">WhatsApp</span>
        <span class="min-w-0 truncate text-sm font-medium text-ink">{{ current.label }}</span>
        <span class="hidden truncate text-xs text-ink-muted lg:inline">{{ current.displayPhoneNumber }}</span>
        <app-icon name="chevronDown" [size]="14" class="shrink-0 text-ink-muted" />
      </button>

      @if (open()) {
        <div class="fixed inset-0 z-40" aria-hidden="true" (click)="open.set(false)"></div>
        <div
          class="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl bg-surface shadow-lg ring-1 ring-line animate-rise"
        >
          <p class="border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Work on number
          </p>
          <ul role="listbox" aria-label="WhatsApp numbers" class="app-scrollbar max-h-80 overflow-y-auto py-1">
            @for (account of context.accounts(); track account.id) {
              <li>
                <button
                  type="button"
                  role="option"
                  [attr.aria-selected]="account.id === current.id"
                  class="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                  (click)="choose(account.id)"
                >
                  <app-whatsapp-health [account]="account" />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-1.5">
                      <span class="truncate text-sm font-medium text-ink">{{ account.label }}</span>
                      @if (account.id === defaultId()) {
                        <span class="rounded bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700">Default</span>
                      }
                    </span>
                    <span class="block truncate text-xs text-ink-muted">{{ account.displayPhoneNumber }}</span>
                  </span>
                  @if (account.id === current.id) {
                    <app-icon name="checkCircle" [size]="16" class="shrink-0 text-brand-600" />
                  }
                </button>
              </li>
            }
          </ul>
          @if (canManage()) {
            <a
              [routerLink]="manageRoute()"
              class="flex items-center gap-2 border-t border-line px-4 py-2.5 text-sm text-brand-700 transition-colors hover:bg-surface-muted"
              (click)="open.set(false)"
            >
              <app-icon name="cog" [size]="15" />
              Manage numbers
            </a>
          }
        </div>
      }
    }
  `,
})
export class WhatsAppSwitcherComponent {
  protected readonly context = inject(WhatsAppContextService);
  private readonly auth = inject(AuthService);

  protected readonly open = signal(false);

  protected readonly defaultId = computed(() => this.context.defaultAccount()?.id ?? null);

  protected readonly canManage = computed(() => this.auth.hasPermission('whatsapp.connect'));

  protected readonly manageRoute = computed(() =>
    this.auth.isSuperAdmin() ? '/superadmin/whatsapp' : '/whatsapp',
  );

  protected choose(id: string): void {
    this.context.select(id);
    this.open.set(false);
  }
}
