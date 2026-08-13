import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { ImportBatchStatus } from '@core/models/contact-import.model';
import { IMPORT_STATUS_LABELS, isImportInFlight } from '@core/models/contact-import.model';
import { BadgeComponent, type BadgeTone } from '@shared/ui/badge/badge.component';

const TONES: Readonly<Record<ImportBatchStatus, BadgeTone>> = {
  pending: 'neutral',
  processing: 'info',
  awaitingMapping: 'warning',
  committing: 'info',
  completed: 'success',
  completedWithErrors: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};

/**
 * One consistent reading of a batch's state.
 *
 * A pulsing dot marks the states a worker is actively moving, which is what
 * tells the user at a glance that leaving the page is safe.
 */
@Component({
  selector: 'app-import-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BadgeComponent],
  // The gentle fade is the only cue that something is still moving, since the
  // page itself is deliberately static while a worker runs.
  host: { '[class.animate-pulse]': 'live()' },
  template: `
    <app-badge [tone]="tone()" [dot]="true">{{ label() }}</app-badge>
  `,
})
export class ImportStatusBadgeComponent {
  readonly status = input.required<ImportBatchStatus>();

  protected readonly tone = computed(() => TONES[this.status()]);
  protected readonly label = computed(() => IMPORT_STATUS_LABELS[this.status()]);
  protected readonly live = computed(() => isImportInFlight(this.status()));
}
