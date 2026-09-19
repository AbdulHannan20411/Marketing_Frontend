import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { DeviceSession } from '@core/models/session-security.model';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

/**
 * Devices a person has signed in from, with a revoke on each.
 *
 * Shared by "your devices" and the admin's view of an employee, so both read
 * the same way. Never offers revoke on the current device: ending your own
 * session from here is just signing out, and the button would suggest it
 * does something more.
 */
@Component({
  selector: 'app-device-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TimeAgoPipe, ButtonDirective, IconComponent],
  template: `
    <ul class="divide-y divide-line/70">
      @for (device of devices(); track device.sessionId) {
        <li class="flex flex-wrap items-start gap-3 py-3.5 first:pt-0 last:pb-0">
          <span
            class="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
            [class]="device.isCurrent ? 'bg-brand-50 text-brand-700' : 'bg-surface-sunken text-ink-muted'"
            aria-hidden="true"
          >
            <app-icon [name]="device.deviceType === 'desktop' ? 'computer' : 'phone'" [size]="19" />
          </span>

          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              {{ device.deviceLabel }}
              @if (device.isCurrent) {
                <span class="rounded bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700 ring-1 ring-brand-200 ring-inset">
                  This device
                </span>
              }
              @if (device.isActive) {
                <span class="inline-flex items-center gap-1 text-[11px] font-normal text-green-700">
                  <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                  Active now
                </span>
              }
            </p>
            <p class="mt-0.5 text-xs text-ink-muted">
              {{ device.location ?? 'Unknown location' }} · {{ device.ipAddress }}
            </p>
            <p class="mt-0.5 text-xs text-ink-muted">
              Last active {{ device.lastActiveAt | timeAgo }} · first seen {{ device.firstSeenAt | timeAgo }} ·
              {{ device.signIns }} sign-in{{ device.signIns === 1 ? '' : 's' }}
            </p>
          </div>

          @if (!device.isCurrent && device.canRevoke) {
            <button
              appButton
              variant="outline"
              size="sm"
              class="text-danger"
              [disabled]="revokingId() !== null"
              [attr.aria-label]="'Sign out ' + device.deviceLabel"
              (click)="revoke.emit(device)"
            >
              {{ revokingId() === device.sessionId ? 'Signing out…' : 'Sign out' }}
            </button>
          }
        </li>
      }
    </ul>
  `,
})
export class DeviceListComponent {
  readonly devices = input.required<readonly DeviceSession[]>();
  readonly revokingId = input<string | null>(null);

  readonly revoke = output<DeviceSession>();
}
