import { Injectable, inject, signal } from '@angular/core';
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import type { HubConnection } from '@microsoft/signalr';
import { Subject, type Observable } from 'rxjs';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import type { Campaign } from '@core/models/campaign.model';
import type { AppNotification } from '@core/models/notification.model';

export type RealtimeState = 'disconnected' | 'connecting' | 'connected';

/**
 * SignalR client for campaign progress and notification pushes.
 *
 * The token goes on the query string because a browser cannot set headers on a
 * WebSocket handshake; the server accepts `access_token` for `/hubs` only.
 *
 * Group membership is derived server-side from the token's claims — there is no
 * join method, and a client cannot subscribe to another tenant's stream.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);

  private connection: HubConnection | null = null;

  private readonly campaignProgress = new Subject<Campaign>();
  private readonly notifications = new Subject<AppNotification>();
  /** Fires after a reconnect: events missed while offline are never replayed. */
  private readonly resynced = new Subject<void>();

  readonly state = signal<RealtimeState>('disconnected');

  readonly campaignProgress$: Observable<Campaign> = this.campaignProgress.asObservable();
  readonly notifications$: Observable<AppNotification> = this.notifications.asObservable();
  readonly resynced$: Observable<void> = this.resynced.asObservable();

  connect(): void {
    if (this.connection !== null || !this.auth.isAuthenticated()) {
      return;
    }

    this.state.set('connecting');

    const connection = new HubConnectionBuilder()
      .withUrl(environment.realtimeUrl, {
        accessTokenFactory: () => this.auth.accessToken ?? '',
      })
      .withAutomaticReconnect()
      .configureLogging(environment.production ? LogLevel.Error : LogLevel.Warning)
      .build();

    connection.on('campaignProgress', (campaign: Campaign) => this.campaignProgress.next(campaign));
    connection.on('notificationReceived', (notification: AppNotification) =>
      this.notifications.next(notification),
    );

    connection.onreconnecting(() => this.state.set('connecting'));
    connection.onreconnected(() => {
      this.state.set('connected');
      // Tell listeners to refetch — the hub does not replay missed events.
      this.resynced.next();
    });
    connection.onclose(() => this.state.set('disconnected'));

    this.connection = connection;

    connection
      .start()
      .then(() => this.state.set('connected'))
      // Realtime is an enhancement; the app stays usable on plain HTTP polling-free reads.
      .catch(() => this.state.set('disconnected'));
  }

  disconnect(): void {
    const connection = this.connection;
    this.connection = null;
    this.state.set('disconnected');

    if (connection !== null && connection.state !== HubConnectionState.Disconnected) {
      void connection.stop();
    }
  }
}
