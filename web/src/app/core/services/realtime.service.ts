import { Injectable, inject, signal } from '@angular/core';
import type { HubConnection } from '@microsoft/signalr';
import { Subject, type Observable } from 'rxjs';

import { environment } from '@env/environment';
import { AuthService } from '@core/auth/auth.service';
import type { ImportNotificationDto } from '@core/dto/contact-import.dto';
import { toImportProgress } from '@core/dto/contact-import.dto';
import type { PaymentRequestNotificationDto } from '@core/dto/payment-request.dto';
import { toPaymentRequestEvent } from '@core/dto/payment-request.dto';
import type { Campaign } from '@core/models/campaign.model';
import type { ImportProgressEvent } from '@core/models/contact-import.model';
import type { AppNotification, AppNotificationDto } from '@core/models/notification.model';
import { toNotification } from '@core/models/notification.model';
import type { PaymentRequestEvent } from '@core/models/payment-request.model';
import type { Conversation, InboundMessageEvent } from '@core/models/whatsapp.model';

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
  /** True while the client is being fetched, so a second call does not start a second one. */
  private connecting = false;

  private readonly campaignProgress = new Subject<Campaign>();
  private readonly importProgress = new Subject<ImportProgressEvent>();
  private readonly paymentRequests = new Subject<PaymentRequestEvent>();
  private readonly notifications = new Subject<AppNotification>();
  private readonly inboundMessages = new Subject<InboundMessageEvent>();
  private readonly conversationAssignments = new Subject<Conversation>();
  /** Fires after a reconnect: events missed while offline are never replayed. */
  private readonly resynced = new Subject<void>();

  readonly state = signal<RealtimeState>('disconnected');

  readonly campaignProgress$: Observable<Campaign> = this.campaignProgress.asObservable();
  /** Contact-import batch moved on. See `ImportNotificationService`. */
  readonly importProgress$: Observable<ImportProgressEvent> = this.importProgress.asObservable();
  /**
   * A manual payment was submitted or decided. Both audiences listen: the
   * platform queue gains a row, and the customer sees their own status change.
   */
  readonly paymentRequests$: Observable<PaymentRequestEvent> = this.paymentRequests.asObservable();
  readonly notifications$: Observable<AppNotification> = this.notifications.asObservable();
  /** A customer messaged in. The inbox updates in place; nothing else listens. */
  readonly inboundMessages$: Observable<InboundMessageEvent> = this.inboundMessages.asObservable();
  /** Someone assigned or unassigned a conversation; carries the updated thread. */
  readonly conversationAssignments$: Observable<Conversation> = this.conversationAssignments.asObservable();
  readonly resynced$: Observable<void> = this.resynced.asObservable();

  connect(): void {
    if (this.connection !== null || this.connecting || !this.auth.isAuthenticated()) {
      return;
    }
    this.connecting = true;
    this.state.set('connecting');
    void this.open();
  }

  /**
   * The SignalR client is 60 KB and nothing on screen waits for it, so it is
   * fetched after the shell renders rather than bundled into it.
   */
  private async open(): Promise<void> {
    const signalR = await import('@microsoft/signalr');
    this.connecting = false;

    // Signed out, or disconnect() ran, while the client was loading.
    if (this.connection !== null || !this.auth.isAuthenticated()) {
      this.state.set('disconnected');
      return;
    }

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(environment.realtimeUrl, {
        accessTokenFactory: () => this.auth.accessToken ?? '',
        // Connect straight over WebSockets and skip the negotiate request.
        //
        // The SignalR client always sends `X-Requested-With` on negotiate, and
        // the API's CORS policy allows only Authorization, Content-Type, Accept
        // and X-Correlation-Id — so the preflight fails. Skipping negotiation
        // sidesteps it; the token rides the query string, which is why the
        // server accepts `access_token` there for /hubs.
        //
        // Remove this once the API adds X-Requested-With to its allowed headers,
        // which would also restore the long-polling fallback.
        transport: signalR.HttpTransportType.WebSockets,
        skipNegotiation: true,
      })
      .withAutomaticReconnect()
      .configureLogging(environment.production ? signalR.LogLevel.Error : signalR.LogLevel.Warning)
      .build();

    connection.on('campaignProgress', (campaign: Campaign) => this.campaignProgress.next(campaign));
    connection.on('importProgress', (event: ImportNotificationDto) =>
      this.importProgress.next(toImportProgress(event)),
    );
    connection.on('paymentRequestUpdated', (event: PaymentRequestNotificationDto) =>
      this.paymentRequests.next(toPaymentRequestEvent(event)),
    );
    // Normalised on the way in, exactly as the REST payload is. A pushed
    // notification is the same untrusted shape from the same server; the only
    // difference is which door it arrived through.
    connection.on('notificationReceived', (notification: AppNotificationDto) =>
      this.notifications.next(toNotification(notification)),
    );

    // Both are delivered per user, only to people who may view that number.
    connection.on('inboundMessage', (event: InboundMessageEvent) =>
      this.inboundMessages.next(event),
    );
    connection.on('conversationAssigned', (conversation: Conversation) =>
      this.conversationAssignments.next(conversation),
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

    // The literal rather than HubConnectionState: importing the enum as a value
    // would pull the whole client back into this bundle.
    if (connection !== null && connection.state !== 'Disconnected') {
      void connection.stop();
    }
  }
}
