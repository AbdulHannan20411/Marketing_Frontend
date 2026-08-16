import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';

import type {
  MessageTemplate,
  TemplateButtonDraft,
  TemplateButtonKind,
  TemplateCategory,
  TemplateDraft,
  TemplateHeaderKind,
} from '@core/models/whatsapp.model';
import {
  TEMPLATE_LIMITS,
  TEMPLATE_NAME_PATTERN,
  templateBodyProblem,
  templateVariables,
} from '@core/models/whatsapp.model';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

interface CategoryOption {
  readonly value: TemplateCategory;
  readonly label: string;
  readonly description: string;
}

/**
 * Meta's three categories, described by what they are *for* rather than by
 * name — picking the wrong one is the most common cause of rejection, and of
 * being re-categorised later at a higher price.
 */
const CATEGORIES: readonly CategoryOption[] = [
  {
    value: 'marketing',
    label: 'Marketing',
    description: 'Offers, product news, invitations, abandoned carts — anything promotional.',
  },
  {
    value: 'utility',
    label: 'Utility',
    description: 'Order updates, appointment reminders, receipts — tied to a specific transaction.',
  },
  {
    value: 'authentication',
    label: 'Authentication',
    description: 'One-time passcodes and account verification only.',
  },
];

const HEADER_KINDS: readonly { value: TemplateHeaderKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'document', label: 'Document' },
];

const BUTTON_KINDS: readonly { value: TemplateButtonKind; label: string; hint: string }[] = [
  { value: 'quick_reply', label: 'Quick reply', hint: 'Sends the label back as a reply.' },
  { value: 'url', label: 'Visit website', hint: 'Opens a link.' },
  { value: 'phone_number', label: 'Call', hint: 'Dials a number.' },
];

/**
 * Compose a template and submit it to Meta.
 *
 * Everything Meta will reject is caught here — name format, placeholder
 * numbering, length ceilings — because a rejection costs a review cycle
 * measured in hours, not the seconds a client-side check costs.
 *
 * Only rejected templates can be edited. An approved one is immutable at Meta;
 * changing it means submitting a new template under a new name.
 */
@Component({
  selector: 'app-template-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonDirective, IconComponent],
  templateUrl: './template-editor.component.html',
})
export class TemplateEditorComponent {
  /** Present when resubmitting a rejected template. */
  readonly template = input<MessageTemplate | null>(null);
  readonly saving = input(false);

  readonly submitted = output<TemplateDraft>();
  readonly cancelled = output<void>();

  protected readonly categories = CATEGORIES;
  protected readonly headerKinds = HEADER_KINDS;
  protected readonly buttonKinds = BUTTON_KINDS;
  protected readonly limits = TEMPLATE_LIMITS;

  protected readonly name = signal('');
  protected readonly category = signal<TemplateCategory>('marketing');
  protected readonly language = signal('en_US');
  protected readonly headerKind = signal<TemplateHeaderKind>('none');
  protected readonly headerText = signal('');
  protected readonly bodyText = signal('');
  protected readonly footerText = signal('');
  protected readonly buttons = signal<readonly TemplateButtonDraft[]>([]);

  protected readonly isEdit = computed(() => this.template() !== null);

  protected readonly variables = computed(() => templateVariables(this.bodyText()));
  protected readonly bodyProblem = computed(() => templateBodyProblem(this.bodyText()));

  protected readonly nameProblem = computed(() => {
    const value = this.name().trim();
    if (value === '') {
      return 'A name is required.';
    }
    if (!TEMPLATE_NAME_PATTERN.test(value)) {
      return 'Use lowercase letters, numbers and underscores only.';
    }
    if (value.length > TEMPLATE_LIMITS.nameMaxLength) {
      return `Names cannot exceed ${TEMPLATE_LIMITS.nameMaxLength} characters.`;
    }
    return null;
  });

  protected readonly headerProblem = computed(() =>
    this.headerKind() === 'text' && this.headerText().trim() === ''
      ? 'Add header text, or choose a different header type.'
      : null,
  );

  protected readonly buttonProblem = computed(() => {
    for (const button of this.buttons()) {
      if (button.label.trim() === '') {
        return 'Every button needs a label.';
      }
      if (button.kind !== 'quick_reply' && button.value.trim() === '') {
        return 'Link and call buttons need a destination.';
      }
    }
    return null;
  });

  protected readonly invalid = computed(
    () =>
      this.nameProblem() !== null ||
      this.bodyProblem() !== null ||
      this.headerProblem() !== null ||
      this.buttonProblem() !== null,
  );

  protected readonly canAddButton = computed(
    () => this.buttons().length < TEMPLATE_LIMITS.maxButtons,
  );

  /** Body with placeholders rendered as sample values, for the preview. */
  protected readonly preview = computed(() =>
    this.bodyText().replace(/\{\{\s*(\d+)\s*\}\}/g, (_, index: string) => `«value ${index}»`),
  );

  constructor() {
    effect(() => {
      const source = this.template();
      untracked(() => this.reset(source));
    });
  }

  private reset(source: MessageTemplate | null): void {
    if (source === null) {
      this.name.set('');
      this.category.set('marketing');
      this.language.set('en_US');
      this.headerKind.set('none');
      this.headerText.set('');
      this.bodyText.set('');
      this.footerText.set('');
      this.buttons.set([]);
      return;
    }

    this.name.set(source.name);
    this.category.set(source.category);
    this.language.set(source.language);
    this.headerKind.set(source.headerText === null ? 'none' : 'text');
    this.headerText.set(source.headerText ?? '');
    this.bodyText.set(source.bodyText);
    this.footerText.set(source.footerText ?? '');
    // Stored buttons are labels only; the kind is not round-tripped by the API.
    this.buttons.set(
      source.buttons.map((label) => ({ kind: 'quick_reply' as const, label, value: '' })),
    );
  }

  protected setCategory(value: TemplateCategory): void {
    this.category.set(value);
  }

  protected setHeaderKind(value: string): void {
    this.headerKind.set(value as TemplateHeaderKind);
  }

  protected addButton(): void {
    if (!this.canAddButton()) {
      return;
    }
    this.buttons.update((current) => [...current, { kind: 'quick_reply', label: '', value: '' }]);
  }

  protected updateButton(index: number, patch: Partial<TemplateButtonDraft>): void {
    this.buttons.update((current) =>
      current.map((button, i) => (i === index ? { ...button, ...patch } : button)),
    );
  }

  protected removeButton(index: number): void {
    this.buttons.update((current) => current.filter((_, i) => i !== index));
  }

  /** Appends the next placeholder, so numbering cannot drift out of sequence. */
  protected insertVariable(): void {
    const next = this.variables().length + 1;
    this.bodyText.update((body) => `${body}{{${next}}}`);
  }

  protected submit(): void {
    if (this.invalid() || this.saving()) {
      return;
    }

    this.submitted.emit({
      name: this.name().trim(),
      category: this.category(),
      language: this.language(),
      headerKind: this.headerKind(),
      headerText: this.headerKind() === 'text' ? this.headerText().trim() : '',
      bodyText: this.bodyText().trim(),
      footerText: this.footerText().trim(),
      buttons: this.buttons().map((button) => ({
        kind: button.kind,
        label: button.label.trim(),
        value: button.value.trim(),
      })),
    });
  }
}
