import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

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
  templateVariables,
} from '@core/models/whatsapp.model';
import {
  TEMPLATE_EMOJI,
  distinctPlaceholders,
  insertAt,
  renderWhatsAppPreview,
  templateChecks,
  toggleFormat,
  type TemplateCheck,
  type TemplateCheckField,
  type TextEdit,
  type WhatsAppFormat,
} from '@core/models/template-rules.model';
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

/** The toolbar: WhatsApp's four formats, with the shortcut each answers to. */
const FORMATS: readonly { format: WhatsAppFormat; label: string; sample: string; shortcut: string | null }[] = [
  { format: 'bold', label: 'Bold', sample: 'B', shortcut: 'b' },
  { format: 'italic', label: 'Italic', sample: 'I', shortcut: 'i' },
  { format: 'strike', label: 'Strikethrough', sample: 'S', shortcut: null },
  { format: 'mono', label: 'Monospace', sample: '</>', shortcut: null },
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
  protected readonly formats = FORMATS;
  protected readonly emoji = TEMPLATE_EMOJI;

  private readonly bodyInput = viewChild<ElementRef<HTMLTextAreaElement>>('bodyInput');
  protected readonly emojiOpen = signal(false);

  protected readonly name = signal('');
  protected readonly category = signal<TemplateCategory>('marketing');
  protected readonly language = signal('en_US');
  protected readonly headerKind = signal<TemplateHeaderKind>('none');
  protected readonly headerText = signal('');
  protected readonly bodyText = signal('');
  protected readonly footerText = signal('');
  protected readonly buttons = signal<readonly TemplateButtonDraft[]>([]);
  /** Indexed by variable number minus one. */
  protected readonly bodyExamples = signal<readonly string[]>([]);
  protected readonly headerExample = signal('');

  protected readonly isEdit = computed(() => this.template() !== null);

  protected readonly variables = computed(() => templateVariables(this.bodyText()));
  protected readonly variableNumbers = computed(() => distinctPlaceholders(this.bodyText()));
  protected readonly headerHasVariable = computed(
    () => this.headerKind() === 'text' && distinctPlaceholders(this.headerText()).length > 0,
  );

  /** Meta's review rules, re-run on every keystroke. */
  protected readonly checks = computed<readonly TemplateCheck[]>(() =>
    templateChecks({
      category: this.category(),
      headerKind: this.headerKind(),
      headerText: this.headerText(),
      bodyText: this.bodyText(),
      bodyExamples: this.bodyExamples(),
      headerExample: this.headerExample(),
      footerText: this.footerText(),
      buttons: this.buttons(),
    }),
  );
  protected readonly errors = computed(() => this.checks().filter((check) => check.level === 'error'));
  protected readonly warnings = computed(() => this.checks().filter((check) => check.level === 'warning'));
  /** Started typing: until then an empty form is not shouted at. */
  protected readonly touched = computed(() => this.bodyText().trim() !== '');

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

  protected readonly invalid = computed(() => this.nameProblem() !== null || this.errors().length > 0);

  protected readonly canAddButton = computed(
    () => this.buttons().length < TEMPLATE_LIMITS.maxButtons,
  );

  /** The body as WhatsApp shows it: formatting applied, examples filled in. Escaped HTML. */
  protected readonly preview = computed(() => renderWhatsAppPreview(this.bodyText(), this.bodyExamples()));
  protected readonly headerPreview = computed(() =>
    this.headerText().replace(/\{\{\s*1\s*\}\}/g, this.headerExample().trim() || '{{1}}'),
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
      this.bodyExamples.set([]);
      this.headerExample.set('');
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
    // Meta does not hand examples back, so a resubmission asks for them again.
    this.bodyExamples.set([]);
    this.headerExample.set('');
  }

  /* ------------------------------ toolbar ------------------------------ */

  /** Writes an edit into the body and restores the selection it describes. */
  private applyEdit(edit: TextEdit): void {
    const element = this.bodyInput()?.nativeElement;
    this.bodyText.set(edit.text);
    if (element !== undefined) {
      element.value = edit.text;
      element.focus();
      element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    }
  }

  private selection(): { start: number; end: number } {
    const element = this.bodyInput()?.nativeElement;
    const length = this.bodyText().length;
    return element === undefined
      ? { start: length, end: length }
      : { start: element.selectionStart, end: element.selectionEnd };
  }

  protected format(format: WhatsAppFormat): void {
    const { start, end } = this.selection();
    this.applyEdit(toggleFormat(this.bodyText(), start, end, format));
  }

  protected insertEmoji(symbol: string): void {
    const { start, end } = this.selection();
    this.applyEdit(insertAt(this.bodyText(), start, end, symbol));
    this.emojiOpen.set(false);
  }

  /** Ctrl/Cmd+B and +I, as in any editor. */
  protected onBodyKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const match = FORMATS.find((entry) => entry.shortcut === event.key.toLowerCase());
    if (match !== undefined) {
      event.preventDefault();
      this.format(match.format);
    }
  }

  protected setExample(index: number, value: string): void {
    this.bodyExamples.update((current) => {
      const next = [...current];
      while (next.length <= index) {
        next.push('');
      }
      next[index] = value;
      return next;
    });
  }

  protected exampleFor(index: number): string {
    return this.bodyExamples()[index] ?? '';
  }

  protected problemsIn(field: TemplateCheckField): readonly TemplateCheck[] {
    return this.checks().filter((check) => check.field === field);
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

  /**
   * Inserts the next placeholder at the cursor, so numbering cannot drift out
   * of sequence. Padded with spaces where it would touch a word, since
   * "Hi{{1}}" reads as one token to Meta's reviewers.
   */
  protected insertVariable(): void {
    const next = (this.variableNumbers().at(-1) ?? 0) + 1;
    const { start, end } = this.selection();
    const text = this.bodyText();
    const before = start > 0 && !/\s/.test(text[start - 1] ?? '') ? ' ' : '';
    const after = end < text.length && !/\s/.test(text[end] ?? '') ? ' ' : '';
    this.applyEdit(insertAt(text, start, end, `${before}{{${next}}}${after}`));
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
      bodyExamples: this.variableNumbers().map((_, index) => this.exampleFor(index).trim()),
      headerExample: this.headerHasVariable() ? this.headerExample().trim() : '',
      footerText: this.footerText().trim(),
      buttons: this.buttons().map((button) => ({
        kind: button.kind,
        label: button.label.trim(),
        value: button.value.trim(),
      })),
    });
  }
}
