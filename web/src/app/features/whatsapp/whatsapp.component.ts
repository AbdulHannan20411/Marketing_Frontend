import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import type { LoadState } from '@core/models/api.model';
import type { QualityRating, WhatsAppConnection } from '@core/models/whatsapp.model';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const QUALITY_TONE: Readonly<Record<QualityRating, BadgeTone>> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
};

const QUALITY_LABEL: Readonly<Record<QualityRating, string>> = {
  green: 'High quality',
  yellow: 'Medium quality',
  red: 'Low quality',
};

@Component({
  selector: 'app-whatsapp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
  ],
  templateUrl: './whatsapp.component.html',
})
export class WhatsAppComponent {
  private readonly whatsapp = inject(WhatsAppService);
  private readonly toast = inject(ToastService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly connection = signal<WhatsAppConnection | null>(null);
  protected readonly syncing = signal(false);

  protected readonly qualityTone = QUALITY_TONE;
  protected readonly qualityLabel = QUALITY_LABEL;

  protected readonly isConnected = computed(() => this.connection()?.status === 'connected');

  /** Share of the rolling 24-hour Meta send ceiling already consumed. */
  protected readonly limitUsedPercent = computed(() => {
    const connection = this.connection();
    if (connection === null || connection.messagingLimit === 0) {
      return 0;
    }
    return Math.min(100, Math.round((connection.messagesLast24h / connection.messagingLimit) * 100));
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.whatsapp.getConnection().subscribe({
      next: (connection) => {
        this.connection.set(connection);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected sync(): void {
    this.syncing.set(true);
    this.whatsapp.syncConnection().subscribe({
      next: (connection) => {
        this.connection.set(connection);
        this.syncing.set(false);
        this.toast.success('Connection refreshed', 'Profile and health pulled from Meta.');
      },
      error: () => this.syncing.set(false),
    });
  }

  protected disconnect(): void {
    this.toast.warning(
      'Disconnect requires confirmation',
      'The confirmation dialog and revoke endpoint land with the connection milestone.',
    );
  }
}
