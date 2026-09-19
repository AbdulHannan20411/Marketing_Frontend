import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import {
  WHATSAPP_ACCESS_COPY,
  WHATSAPP_ACCESS_PERMISSIONS,
  accessProblems,
  toggleAccessPermission,
  type WhatsAppAccessPermission,
  type WhatsAppAccessUpdate,
  type WhatsAppAccount,
} from '@core/models/whatsapp-account.model';

/**
 * Which numbers one person works on, and what they may do on each.
 *
 * Presentational: it edits a `WhatsAppAccessUpdate` and hands back the next
 * one. Saving belongs to whoever uses it — the invite form sends it with the
 * invitation, the access tab saves it on its own.
 *
 * The rules live in `toggleAccessPermission`: Reply and Broadcast tick View,
 * and unticking View clears the row — so the editor can never produce a set
 * the API would refuse.
 */
@Component({
  selector: 'app-whatsapp-access-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (accounts().length === 0) {
      <p class="rounded-lg bg-surface-sunken px-3.5 py-3 text-xs text-ink-muted ring-1 ring-line">
        No WhatsApp number is connected yet. Connect one on the WhatsApp page, then give people access here.
      </p>
    } @else {
      <div class="overflow-x-auto rounded-lg ring-1 ring-line">
        <table class="w-full min-w-[30rem] text-sm">
          <caption class="sr-only">WhatsApp access by number</caption>
          <thead>
            <tr class="border-b border-line bg-surface-sunken text-left text-xs text-ink-muted">
              <th scope="col" class="px-3 py-2 font-medium">Number</th>
              @for (permission of permissions; track permission) {
                <th scope="col" class="px-2 py-2 text-center font-medium" [title]="copy[permission].description">
                  {{ copy[permission].label }}
                </th>
              }
              <th scope="col" class="px-3 py-2 text-center font-medium" title="Used for new work unless they pick another">
                Default
              </th>
            </tr>
          </thead>
          <tbody>
            @for (account of accounts(); track account.id) {
              <tr class="border-b border-line/70 last:border-0">
                <th scope="row" class="px-3 py-2.5 text-left font-normal">
                  <span class="block font-medium text-ink">{{ account.label }}</span>
                  <span class="block text-xs text-ink-muted">{{ account.displayPhoneNumber }}</span>
                </th>
                @for (permission of permissions; track permission) {
                  <td class="px-2 py-2.5 text-center">
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                      [checked]="has(account.id, permission)"
                      [disabled]="disabled()"
                      [attr.aria-label]="copy[permission].label + ' on ' + account.label"
                      (change)="toggle(account.id, permission, $any($event.target).checked)"
                    />
                  </td>
                }
                <td class="px-3 py-2.5 text-center">
                  <input
                    type="radio"
                    name="whatsapp-default"
                    class="h-4 w-4 border-line text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                    [checked]="value().defaultAccountId === account.id"
                    [disabled]="disabled() || !has(account.id, 'view')"
                    [attr.aria-label]="'Make ' + account.label + ' their default number'"
                    (change)="setDefault(account.id)"
                  />
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <p class="mt-2 text-xs text-ink-muted">
        <span class="font-medium text-ink-soft">View</span> reads conversations and templates ·
        <span class="font-medium text-ink-soft">Reply</span> answers customers ·
        <span class="font-medium text-ink-soft">Broadcast</span> sends campaigns. Their overall permissions
        must also allow each action.
      </p>

      @if (problems().length > 0) {
        <ul class="mt-2 list-disc space-y-0.5 pl-5 text-xs text-danger" role="alert">
          @for (problem of problems(); track problem) {
            <li>{{ problem }}</li>
          }
        </ul>
      }
    }
  `,
})
export class WhatsAppAccessEditorComponent {
  readonly accounts = input.required<readonly WhatsAppAccount[]>();
  readonly value = input.required<WhatsAppAccessUpdate>();
  readonly disabled = input(false);

  readonly valueChange = output<WhatsAppAccessUpdate>();

  protected readonly permissions = WHATSAPP_ACCESS_PERMISSIONS;
  protected readonly copy = WHATSAPP_ACCESS_COPY;

  protected readonly problems = computed(() => accessProblems(this.value()));

  protected has(accountId: string, permission: WhatsAppAccessPermission): boolean {
    return this.value().access.some((row) => row.accountId === accountId && row.permissions.includes(permission));
  }

  protected toggle(accountId: string, permission: WhatsAppAccessPermission, enabled: boolean): void {
    const current = this.value();
    const existing = current.access.find((row) => row.accountId === accountId)?.permissions ?? [];
    const next = toggleAccessPermission(existing, permission, enabled);

    // A row with nothing ticked is not "access with no permissions": it is no access.
    const access =
      next.length === 0
        ? current.access.filter((row) => row.accountId !== accountId)
        : current.access.some((row) => row.accountId === accountId)
          ? current.access.map((row) => (row.accountId === accountId ? { accountId, permissions: next } : row))
          : [...current.access, { accountId, permissions: next }];

    // Losing access to the default number loses the default with it; the first
    // remaining number takes over so there is always a sensible choice.
    const stillThere = access.some((row) => row.accountId === current.defaultAccountId);
    const defaultAccountId = stillThere ? current.defaultAccountId : (access[0]?.accountId ?? null);

    this.valueChange.emit({ access, defaultAccountId });
  }

  protected setDefault(accountId: string): void {
    this.valueChange.emit({ ...this.value(), defaultAccountId: accountId });
  }
}
