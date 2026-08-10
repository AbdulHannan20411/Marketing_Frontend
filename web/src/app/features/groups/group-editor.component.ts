import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { ContactGroup, ContactGroupDraft } from '@core/models/contact.model';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

const NAME_MAX = 60;
const DESCRIPTION_MAX = 200;

/** Create or rename a contact group. */
@Component({
  selector: 'app-group-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent, ButtonDirective, IconComponent],
  templateUrl: './group-editor.component.html',
})
export class GroupEditorComponent {
  readonly group = input<ContactGroup | null>(null);
  readonly saving = input(false);
  /** Server-side rejection for the name, e.g. a duplicate. */
  readonly nameError = input<string | null>(null);

  readonly save = output<ContactGroupDraft>();
  readonly cancel = output<void>();

  protected readonly nameMax = NAME_MAX;
  protected readonly descriptionMax = DESCRIPTION_MAX;

  protected readonly name = signal('');
  protected readonly description = signal('');

  protected readonly isEdit = computed(() => this.group() !== null);
  protected readonly title = computed(() =>
    this.isEdit() ? `Rename ${this.group()?.name}` : 'New group',
  );

  protected readonly nameInvalid = computed(() => {
    const value = this.name().trim();
    return value.length === 0 || value.length > NAME_MAX;
  });

  protected readonly descriptionInvalid = computed(
    () => this.description().length > DESCRIPTION_MAX,
  );

  protected readonly invalid = computed(() => this.nameInvalid() || this.descriptionInvalid());

  constructor() {
    effect(() => {
      const source = this.group();
      this.name.set(source?.name ?? '');
      this.description.set(source?.description ?? '');
    });
  }

  protected submit(): void {
    if (this.invalid() || this.saving()) {
      return;
    }
    this.save.emit({
      name: this.name().trim(),
      description: this.description().trim(),
    });
  }
}
