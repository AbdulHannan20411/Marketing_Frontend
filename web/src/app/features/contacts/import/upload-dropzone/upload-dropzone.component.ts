import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import type {
  ImportDuplicateStrategy,
  ImportUploadAccepted,
} from '@core/models/contact-import.model';
import {
  ACCEPTED_IMPORT_ACCEPT_ATTR,
  DEFAULT_DUPLICATE_STRATEGY,
  IMPORT_DUPLICATE_STRATEGIES,
  MAX_IMPORT_FILE_BYTES,
  describeFileSize,
  rejectionReason,
} from '@core/models/contact-import.model';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

/**
 * Drag-and-drop upload area for a contact file.
 *
 * It never waits for the import: once the API accepts the file the panel flips
 * to a short confirmation with a way through to the batch, because parsing runs
 * on a worker and could take minutes on a large file. There is deliberately no
 * blocking spinner and no progress bar for work the browser is not doing.
 *
 * Obviously wrong files are refused here — wrong extension, over the size cap,
 * empty — so the user is told in the same breath rather than after a round trip.
 * The server still validates everything.
 *
 * The duplicate choice lives here rather than on the confirm step because the
 * API fixes it at upload: the parse classifies rows against it and it cannot be
 * changed afterwards.
 */
@Component({
  selector: 'app-upload-dropzone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonDirective, IconComponent],
  templateUrl: './upload-dropzone.component.html',
})
export class UploadDropzoneComponent {
  /** Set while the POST is in flight — brief, since it only hands the file over. */
  readonly uploading = input(false);
  /** Present once the API has taken the file; switches the panel to its accepted state. */
  readonly accepted = input<ImportUploadAccepted | null>(null);
  readonly disabled = input(false);

  /** Carries the chosen duplicate strategy alongside the file. */
  readonly fileSelected = output<{ file: File; duplicateStrategy: ImportDuplicateStrategy }>();
  readonly viewImport = output<string>();
  readonly dismissed = output<void>();

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly acceptAttr = ACCEPTED_IMPORT_ACCEPT_ATTR;
  protected readonly maxSizeLabel = describeFileSize(MAX_IMPORT_FILE_BYTES);
  protected readonly strategies = IMPORT_DUPLICATE_STRATEGIES;

  protected readonly dragging = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly strategy = signal<ImportDuplicateStrategy>(DEFAULT_DUPLICATE_STRATEGY);

  protected readonly locked = computed(() => this.disabled() || this.uploading());

  protected browse(): void {
    if (this.locked()) {
      return;
    }
    this.fileInput().nativeElement.click();
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.locked()) {
      this.dragging.set(true);
    }
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.locked()) {
      return;
    }
    const file = event.dataTransfer?.files.item(0) ?? null;
    this.offer(file);
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.offer(input.files?.item(0) ?? null);
    // Cleared so choosing the same file twice in a row still fires `change`.
    input.value = '';
  }

  protected startOver(): void {
    this.error.set(null);
    this.dismissed.emit();
  }

  private offer(file: File | null): void {
    if (file === null) {
      return;
    }

    const reason = rejectionReason(file);
    if (reason !== null) {
      this.error.set(reason);
      return;
    }

    this.error.set(null);
    this.fileSelected.emit({ file, duplicateStrategy: this.strategy() });
  }

  protected setStrategy(value: ImportDuplicateStrategy): void {
    this.strategy.set(value);
  }

  protected describe(bytes: number): string {
    return describeFileSize(bytes);
  }
}
