import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { ContactTag, ContactTagDraft, TagColor } from '@core/models/contact.model';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

const NAME_MAX = 40;

/**
 * The API accepts only these five values and rejects a hex colour, so the
 * picker offers swatches rather than a colour input.
 */
const COLOURS: readonly { value: TagColor; label: string; swatch: string }[] = [
  { value: 'brand', label: 'Green', swatch: 'bg-brand-500' },
  { value: 'info', label: 'Emerald', swatch: 'bg-emerald-500' },
  { value: 'warning', label: 'Amber', swatch: 'bg-amber-500' },
  { value: 'danger', label: 'Red', swatch: 'bg-red-500' },
  { value: 'neutral', label: 'Grey', swatch: 'bg-slate-400' },
];

@Component({
  selector: 'app-tag-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent, BadgeComponent, ButtonDirective, IconComponent],
  templateUrl: './tag-editor.component.html',
})
export class TagEditorComponent {
  readonly tag = input<ContactTag | null>(null);
  readonly saving = input(false);
  readonly nameError = input<string | null>(null);

  readonly save = output<ContactTagDraft>();
  readonly cancel = output<void>();

  protected readonly colours = COLOURS;
  protected readonly nameMax = NAME_MAX;

  protected readonly name = signal('');
  protected readonly color = signal<TagColor>('neutral');

  protected readonly isEdit = computed(() => this.tag() !== null);
  protected readonly title = computed(() =>
    this.isEdit() ? `Edit ${this.tag()?.name}` : 'New tag',
  );

  protected readonly nameInvalid = computed(() => {
    const value = this.name().trim();
    return value.length === 0 || value.length > NAME_MAX;
  });

  /** Shown live so the operator sees the badge they are actually creating. */
  protected readonly previewName = computed(() => {
    const value = this.name().trim();
    return value.length === 0 ? 'Tag preview' : value;
  });

  constructor() {
    effect(() => {
      const source = this.tag();
      this.name.set(source?.name ?? '');
      this.color.set(source?.color ?? 'neutral');
    });
  }

  protected submit(): void {
    if (this.nameInvalid() || this.saving()) {
      return;
    }
    this.save.emit({ name: this.name().trim(), color: this.color() });
  }
}
