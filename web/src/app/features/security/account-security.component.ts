import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError, LoadState } from '@core/models/api.model';
import type { DeviceSession } from '@core/models/session-security.model';
import { SessionSecurityService } from '@core/services/session-security.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { DeviceListComponent } from './device-list.component';

/**
 * "Where am I signed in?" — and the answer to a "new sign-in" email.
 *
 * The new-sign-in email and notification link here with "This wasn't me", so
 * the page leads with the two things that person needs: sign out the device
 * they don't recognise, then change the password it was signed in with.
 */
@Component({
  selector: 'app-account-security',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageHeaderComponent,
    CardComponent,
    ButtonDirective,
    IconComponent,
    ModalComponent,
    SkeletonComponent,
    ErrorStateComponent,
    DeviceListComponent,
  ],
  template: `
    <div class="animate-fade-in space-y-6">
      <app-page-header
        title="Security and devices"
        description="Where your account is signed in. You can be signed in on one device at a time — signing in somewhere new signs you out here."
        [breadcrumbs]="breadcrumbs"
      />

      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <app-card title="Your devices" subtitle="Devices that have signed in to your account recently.">
          @switch (state()) {
            @case ('loading') {
              <div class="space-y-4" aria-busy="true">
                @for (row of skeletons; track row) {
                  <app-skeleton height="3.5rem" />
                }
              </div>
            }
            @case ('error') {
              <app-error-state
                title="Could not load your devices"
                description="Your account is unaffected. Try again in a moment."
                (retry)="load()"
              />
            }
            @default {
              <app-device-list [devices]="devices()" [revokingId]="revokingId()" (revoke)="confirming.set($event)" />
            }
          }
        </app-card>

        <!-- The "this wasn't me" path, in order. -->
        <app-card title="Don't recognise a device?">
          <ol class="space-y-3 text-sm text-ink-soft">
            <li class="flex gap-2.5">
              <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">1</span>
              Sign it out from the list.
            </li>
            <li class="flex gap-2.5">
              <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">2</span>
              <span>
                Change your password, so it cannot simply sign in again.
                <a [routerLink]="settingsRoute()" [queryParams]="{ edit: 'profile' }" class="mt-1 block font-medium text-brand-700 hover:underline">
                  Change password
                </a>
              </span>
            </li>
          </ol>

          <div class="mt-5 border-t border-line pt-4">
            <p class="text-xs text-ink-muted">Or end every session, this one included, and sign in again.</p>
            <button appButton variant="outline" size="sm" class="mt-2" (click)="confirmingEverywhere.set(true)">
              <app-icon name="logout" [size]="14" />
              Sign out everywhere
            </button>
          </div>
        </app-card>
      </div>
    </div>

    @if (confirming(); as device) {
      <app-modal [title]="'Sign out ' + device.deviceLabel + '?'" size="sm" (closed)="confirming.set(null)">
        <p class="text-sm leading-relaxed text-ink-soft">
          Whoever is using {{ device.deviceLabel }} ({{ device.location ?? 'unknown location' }}) is signed out within
          about half a minute. If you don't recognise it, change your password next.
        </p>
        <button modalFooter appButton variant="ghost" (click)="confirming.set(null)">Cancel</button>
        <button modalFooter appButton variant="danger" [disabled]="revokingId() !== null" (click)="revoke(device)">
          Sign it out
        </button>
      </app-modal>
    }

    @if (confirmingEverywhere()) {
      <app-modal title="Sign out everywhere?" size="sm" (closed)="confirmingEverywhere.set(false)">
        <p class="text-sm leading-relaxed text-ink-soft">
          Every device, including this one, is signed out. You'll need to sign in again.
        </p>
        <button modalFooter appButton variant="ghost" (click)="confirmingEverywhere.set(false)">Cancel</button>
        <button modalFooter appButton variant="danger" (click)="signOutEverywhere()">Sign out everywhere</button>
      </app-modal>
    }
  `,
})
export class AccountSecurityComponent {
  private readonly security = inject(SessionSecurityService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly breadcrumbs = [
    { label: 'Home', route: '/' },
    { label: 'Security and devices', route: null },
  ];
  protected readonly skeletons = [1, 2, 3];

  protected readonly state = signal<LoadState>('loading');
  protected readonly devices = signal<readonly DeviceSession[]>([]);
  protected readonly revokingId = signal<string | null>(null);
  protected readonly confirming = signal<DeviceSession | null>(null);
  protected readonly confirmingEverywhere = signal(false);

  protected readonly settingsRoute = computed(() => (this.auth.isSuperAdmin() ? '/superadmin/settings' : '/settings'));

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.security.mySessions().subscribe({
      next: (devices) => {
        this.devices.set(devices);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected revoke(device: DeviceSession): void {
    this.revokingId.set(device.sessionId);
    this.security.revokeMySession(device.sessionId).subscribe({
      next: () => {
        this.revokingId.set(null);
        this.confirming.set(null);
        this.devices.update((current) => current.filter((entry) => entry.sessionId !== device.sessionId));
        this.toast.success('Device signed out', `${device.deviceLabel} can no longer use your account.`);
      },
      error: (error: ApiError) => {
        this.revokingId.set(null);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected signOutEverywhere(): void {
    this.confirmingEverywhere.set(false);
    this.auth.logoutEverywhere();
  }
}
