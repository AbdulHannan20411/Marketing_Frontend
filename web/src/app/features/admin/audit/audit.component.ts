import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { LoadState } from '@core/models/api.model';
import type { AuditLogEntry, AuditSeverity } from '@core/models/platform.model';
import { PlatformService } from '@core/services/platform.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

const SEVERITY_TONE: Readonly<Record<AuditSeverity, BadgeTone>> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
};

type SeverityFilter = AuditSeverity | 'all';

const PAGE_SIZE = 12;

@Component({
  selector: 'app-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    AvatarComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './audit.component.html',
})
export class AuditComponent {
  private readonly platform = inject(PlatformService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly entries = signal<readonly AuditLogEntry[]>([]);
  protected readonly totalItems = signal(0);
  protected readonly page = signal(1);
  protected readonly severity = signal<SeverityFilter>('all');
  protected readonly skeletons = [1, 2, 3, 4, 5, 6, 7, 8];

  protected readonly severityTone = SEVERITY_TONE;

  protected readonly severities: readonly { value: SeverityFilter; label: string }[] = [
    { value: 'all', label: 'All events' },
    { value: 'critical', label: 'Critical' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Info' },
  ];

  protected readonly visibleEntries = computed(() => {
    const filter = this.severity();
    const all = this.entries();
    return filter === 'all' ? all : all.filter((entry) => entry.severity === filter);
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / PAGE_SIZE)),
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.platform.listAuditLogs(this.page(), PAGE_SIZE).subscribe({
      next: (result) => {
        this.entries.set(result.items);
        this.totalItems.set(result.totalItems);
        this.state.set(result.totalItems === 0 ? 'empty' : 'ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.page.set(page);
      this.load();
    }
  }
}
