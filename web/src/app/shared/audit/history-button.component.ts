import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { hasAuditHistory } from '@core/models/audit-history.model';
import { ButtonDirective, type ButtonSize, type ButtonVariant } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { AuditHistoryComponent } from './audit-history.component';

/**
 * A History button for any record, opening that record's history in the app's
 * own modal:
 *
 * ```html
 * <app-history-button entityName="Template" [entityId]="template.id" [recordName]="template.name" />
 * ```
 *
 * The panel is only created once the modal opens, so a list of fifty rows
 * carrying this button costs fifty buttons — not fifty history panels each
 * asking the API for a page nobody has looked at.
 */
@Component({
  selector: 'app-history-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonDirective, IconComponent, ModalComponent, AuditHistoryComponent],
  template: `
    @if (available()) {
    <button
      appButton
      [variant]="variant()"
      [size]="size()"
      [attr.aria-label]="'History for ' + (recordName() ?? entityName())"
      (click)="open($event)"
    >
      <app-icon name="clock" [size]="iconSize()" />
      @if (showLabel()) {
        {{ label() }}
      }
    </button>

    }

    @if (isOpen()) {
      <app-modal
        [title]="(recordName() ?? entityName()) + ' — history'"
        subtitle="Every change to this record, newest first."
        size="xl"
        (closed)="isOpen.set(false)"
      >
        <app-audit-history
          [entityName]="entityName()"
          [entityId]="entityId()"
          [recordLabel]="entityName()"
        />
        <button modalFooter appButton variant="ghost" (click)="isOpen.set(false)">Close</button>
      </app-modal>
    }
  `,
})
export class HistoryButtonComponent {
  /** As the API names it: `Template`, `Employee`, `Contact`. */
  readonly entityName = input.required<string>();
  readonly entityId = input.required<string>();
  /** This record's own name, for the button's label and the modal's title. */
  readonly recordName = input<string | null>(null);

  readonly label = input('History');
  readonly showLabel = input(true);
  readonly variant = input<ButtonVariant>('ghost');
  readonly size = input<ButtonSize>('sm');

  protected readonly isOpen = signal(false);
  /** Hidden for a record type the API has no history for — see `AUDIT_ENTITIES`. */
  protected readonly available = computed(() => hasAuditHistory(this.entityName()));
  protected readonly iconSize = computed(() => (this.size() === 'sm' ? 14 : 16));

  protected open(event: Event): void {
    // Rows are often clickable themselves; History should not also open the row.
    event.stopPropagation();
    this.isOpen.set(true);
  }
}
