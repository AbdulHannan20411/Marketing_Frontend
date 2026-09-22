import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import type { ApiError, LoadState } from '@core/models/api.model';
import {
  CONTENT_TOKEN,
  renderEmail,
  validateDraft,
} from '@core/models/email-template-renderer';
import {
  EMAIL_LAYOUT_KEY,
  EMAIL_SUBJECT_MAX_LENGTH,
  EMAIL_TEMPLATE_CATEGORY_LABEL,
  EMAIL_TEMPLATE_CATEGORY_ORDER,
  type EmailTemplate,
  type EmailTemplateDraft,
  type EmailTemplateSummary,
  type RenderedEmail,
  variablesFor,
} from '@core/models/email-template.model';
import { EmailTemplatesService } from '@core/services/email-templates.service';
import { ToastService } from '@core/services/toast.service';
import { TimeAgoPipe } from '@shared/pipes/time-ago.pipe';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { HistoryButtonComponent } from '@shared/audit/history-button.component';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';

type EditableField = 'subject' | 'html' | 'text';

/** Stands in for an email while the layout itself is being edited. */
const LAYOUT_PREVIEW_BODY: EmailTemplateDraft = {
  subject: 'Layout preview',
  htmlBody:
    '<h1 style="margin:0 0 12px 0;font-size:22px;line-height:30px;font-weight:700;color:#1e293b;">Every email appears here</h1>' +
    '<p style="margin:0;font-size:15px;line-height:24px;color:#475569;">This is placeholder content. Each template\'s body is placed where the layout has its content slot.</p>',
  textBody: 'Every email appears here.\n\nThis is placeholder content.',
};

/**
 * Super Admin editor for the platform's transactional emails.
 *
 * Preview renders in the browser with the same template rules the server uses
 * (`email-template-renderer.ts`), so it updates on every keystroke. Send test
 * renders on the server — the authoritative check before anyone else receives a
 * change.
 */
@Component({
  selector: 'app-email-templates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HistoryButtonComponent,
    TimeAgoPipe,
    PageHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    ModalComponent,
    SkeletonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  templateUrl: './email-templates.component.html',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class EmailTemplatesComponent {
  private readonly service = inject(EmailTemplatesService);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly breadcrumbs = [
    { label: 'Platform', route: null },
    { label: 'Email templates', route: null },
  ];
  protected readonly skeletons = [1, 2, 3, 4, 5, 6];

  protected readonly subjectMax = EMAIL_SUBJECT_MAX_LENGTH;
  protected readonly contentToken = CONTENT_TOKEN;
  protected readonly variableHint = 'Click to insert at the cursor. Values are HTML-escaped automatically.';
  protected readonly contentHint = `Where each email's content goes. The layout needs ${CONTENT_TOKEN} exactly once.`;
  protected readonly previewNote =
    'Rendered in your browser with sample data, so it follows every keystroke. Send test renders on the server and delivers to your own inbox.';

  /* ------------------------------ list ------------------------------ */

  protected readonly listState = signal<LoadState>('loading');
  protected readonly summaries = signal<readonly EmailTemplateSummary[]>([]);

  protected readonly groups = computed(() =>
    EMAIL_TEMPLATE_CATEGORY_ORDER.map((category) => ({
      category,
      label: EMAIL_TEMPLATE_CATEGORY_LABEL[category],
      items: this.summaries().filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0),
  );

  /* ----------------------------- editor ----------------------------- */

  protected readonly selectedKey = signal<string | null>(null);
  protected readonly editorState = signal<LoadState>('loading');
  protected readonly template = signal<EmailTemplate | null>(null);
  /** The saved layout, for wrapping previews of every other template. */
  private readonly layout = signal<EmailTemplate | null>(null);

  protected readonly subject = signal('');
  protected readonly htmlBody = signal('');
  protected readonly textBody = signal('');

  protected readonly bodyTab = signal<'html' | 'text'>('html');
  protected readonly previewWidth = signal<'desktop' | 'mobile'>('desktop');

  protected readonly saving = signal(false);
  protected readonly sendingTest = signal(false);
  protected readonly resetting = signal(false);

  /** Set when switching away from unsaved changes; the modal asks first. */
  protected readonly pendingKey = signal<string | null>(null);
  protected readonly confirmingReset = signal(false);

  /** Where a clicked variable goes. Updated on focus. */
  protected lastField: EditableField = 'html';

  private readonly subjectInput = viewChild<ElementRef<HTMLInputElement>>('subjectInput');
  private readonly htmlArea = viewChild<ElementRef<HTMLTextAreaElement>>('htmlArea');
  private readonly textArea = viewChild<ElementRef<HTMLTextAreaElement>>('textArea');

  protected readonly isLayout = computed(() => this.template()?.key === EMAIL_LAYOUT_KEY);

  protected readonly draft = computed<EmailTemplateDraft>(() => ({
    subject: this.subject(),
    htmlBody: this.htmlBody(),
    textBody: this.textBody(),
  }));

  protected readonly dirty = computed(() => {
    const template = this.template();
    return (
      template !== null &&
      (template.subject !== this.subject() ||
        template.htmlBody !== this.htmlBody() ||
        template.textBody !== this.textBody())
    );
  });

  protected readonly variables = computed(() => {
    const template = this.template();
    return template === null ? [] : variablesFor(template);
  });

  /** The same checks the server applies — nothing is saved that it would refuse. */
  protected readonly problems = computed(() =>
    this.template() === null
      ? []
      : validateDraft(this.draft(), {
          allowedVariables: this.variables().map((variable) => variable.name),
          isLayout: this.isLayout(),
        }),
  );

  protected readonly canSave = computed(
    () => this.dirty() && this.problems().length === 0 && !this.saving(),
  );

  private readonly sampleValues = computed<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(this.variables().map((variable) => [variable.name, variable.sample])),
  );

  protected readonly rendered = computed<RenderedEmail | null>(() => {
    if (this.template() === null) {
      return null;
    }
    if (this.isLayout()) {
      return renderEmail(LAYOUT_PREVIEW_BODY, this.draft(), this.sampleValues());
    }
    const layout = this.layout();
    return renderEmail(this.draft(), layout, this.sampleValues());
  });

  /**
   * Trusted only because of where it lands: an iframe with an empty `sandbox`,
   * which runs no scripts, has no access to this app, and cannot navigate the
   * page. Email clients are at least that strict, so it is also the more honest
   * preview.
   */
  protected readonly previewDocument = computed<SafeHtml | null>(() => {
    const email = this.rendered();
    return email === null ? null : this.sanitizer.bypassSecurityTrustHtml(email.html);
  });

  constructor() {
    this.loadList();
  }

  protected tokenFor(name: string): string {
    return `{{${name}}}`;
  }

  /* ------------------------------ loading ------------------------------ */

  protected loadList(): void {
    this.listState.set('loading');
    this.service.list().subscribe({
      next: (items) => {
        this.summaries.set(items);
        this.listState.set(items.length === 0 ? 'empty' : 'ready');

        if (this.selectedKey() === null) {
          // Open a real email first; the layout is rarely what someone came for.
          const first = items.find((item) => item.key !== EMAIL_LAYOUT_KEY) ?? items[0];
          if (first !== undefined) {
            this.openTemplate(first.key);
          }
        }
      },
      error: () => this.listState.set('error'),
    });
  }

  protected select(key: string): void {
    if (key === this.selectedKey()) {
      return;
    }
    if (this.dirty()) {
      this.pendingKey.set(key);
      return;
    }
    this.openTemplate(key);
  }

  protected confirmDiscard(): void {
    const key = this.pendingKey();
    this.pendingKey.set(null);
    if (key !== null) {
      this.openTemplate(key);
    }
  }

  protected reloadSelected(): void {
    const key = this.selectedKey();
    if (key !== null) {
      this.openTemplate(key);
    }
  }

  private openTemplate(key: string): void {
    this.selectedKey.set(key);
    this.editorState.set('loading');
    this.bodyTab.set('html');
    this.lastField = 'html';

    this.service.get(key).subscribe({
      next: (template) => {
        // A slower response for a template the user has already left is dropped.
        if (this.selectedKey() !== key) {
          return;
        }
        this.apply(template);
        this.editorState.set('ready');
      },
      error: () => {
        if (this.selectedKey() === key) {
          this.editorState.set('error');
        }
      },
    });

    if (key !== EMAIL_LAYOUT_KEY && this.layout() === null) {
      // Without it the preview shows the bare body — still useful, so a failure is not an error.
      this.service.get(EMAIL_LAYOUT_KEY).subscribe({
        next: (layout) => this.layout.set(layout),
        error: () => undefined,
      });
    }
  }

  private apply(template: EmailTemplate): void {
    this.template.set(template);
    this.subject.set(template.subject);
    this.htmlBody.set(template.htmlBody);
    this.textBody.set(template.textBody);
    if (template.key === EMAIL_LAYOUT_KEY) {
      this.layout.set(template);
    }
  }

  /* ------------------------------ editing ------------------------------ */

  protected insertVariable(name: string): void {
    this.insert(this.tokenFor(name));
  }

  protected insertContent(): void {
    this.insert(CONTENT_TOKEN);
  }

  /** Inserts at the caret of whichever field was last focused, then puts the caret after it. */
  private insert(token: string): void {
    const field: EditableField = this.lastField === 'subject' ? 'subject' : this.bodyTab();
    const element =
      field === 'subject'
        ? this.subjectInput()?.nativeElement
        : field === 'html'
          ? this.htmlArea()?.nativeElement
          : this.textArea()?.nativeElement;
    const target = field === 'subject' ? this.subject : field === 'html' ? this.htmlBody : this.textBody;

    const current = target();
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    target.set(current.slice(0, start) + token + current.slice(end));

    // After change detection has written the new value, or the caret jumps to the end.
    const caret = start + token.length;
    setTimeout(() => {
      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  }

  protected discardChanges(): void {
    const template = this.template();
    if (template !== null) {
      this.apply(template);
    }
  }

  protected save(): void {
    const key = this.selectedKey();
    if (key === null || !this.canSave()) {
      return;
    }
    this.saving.set(true);

    this.service.update(key, this.draft()).subscribe({
      next: (template) => {
        this.saving.set(false);
        this.apply(template);
        this.upsertSummary(template);
        this.toast.success('Template saved', `${template.name} is used from the next email sent.`);
      },
      error: (error: ApiError) => {
        this.saving.set(false);
        this.reportFailure(error);
      },
    });
  }

  protected sendTest(): void {
    const key = this.selectedKey();
    if (key === null || this.sendingTest() || this.problems().length > 0) {
      return;
    }
    this.sendingTest.set(true);

    this.service.sendTest(key, this.draft()).subscribe({
      next: (result) => {
        this.sendingTest.set(false);
        this.toast.success(
          'Test email sent',
          `Sent to ${result.sentTo} with sample data${this.dirty() ? ', including your unsaved changes' : ''}.`,
        );
      },
      error: (error: ApiError) => {
        this.sendingTest.set(false);
        this.reportFailure(error);
      },
    });
  }

  protected confirmReset(): void {
    const key = this.selectedKey();
    if (key === null || this.resetting()) {
      return;
    }
    this.resetting.set(true);

    this.service.reset(key).subscribe({
      next: (template) => {
        this.resetting.set(false);
        this.confirmingReset.set(false);
        this.apply(template);
        this.upsertSummary(template);
        this.toast.success('Template reset', `${template.name} is back to the shipped version.`);
      },
      error: (error: ApiError) => {
        this.resetting.set(false);
        this.reportFailure(error);
      },
    });
  }

  /**
   * One toast per failure, with something in it.
   *
   * - 429 (test sends are limited to 10 a minute): the error interceptor has
   *   already shown "please wait", so a second toast would only repeat it.
   * - 422: the API puts every problem under `errors.Template` with no detail.
   *   The editor blocks these first, so reaching here means the rules drifted
   *   apart — showing the server's own words is the useful thing.
   */
  private reportFailure(error: ApiError): void {
    if (error.status === 429) {
      return;
    }
    const problems = error.fieldErrors['Template'] ?? [];
    if (error.status === 422 && problems.length > 0) {
      this.toast.error('The server refused this template', problems.join(' '));
      return;
    }
    this.toast.error(error.title, error.detail);
  }

  private upsertSummary(template: EmailTemplate): void {
    this.summaries.update((items) =>
      items.map((item) =>
        item.key === template.key
          ? {
              key: template.key,
              name: template.name,
              description: template.description,
              category: template.category,
              subject: template.subject,
              isCustomised: template.isCustomised,
              updatedAt: template.updatedAt,
              updatedBy: template.updatedBy,
            }
          : item,
      ),
    );
  }

  /** Leaving the page — reload, close, another URL — asks before throwing edits away. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
