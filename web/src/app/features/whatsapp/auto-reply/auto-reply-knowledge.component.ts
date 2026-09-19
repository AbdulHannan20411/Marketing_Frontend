import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import type { ApiError } from '@core/models/api.model';
import {
  countByKind,
  DEFAULT_FALLBACK_MESSAGE,
  KNOWLEDGE_FALLBACK_OPTIONS,
  KNOWLEDGE_KIND_COPY,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_LIMITS,
  KnowledgeFileError,
  legacyNotesEntry,
  type AutoReplyKnowledge,
  type KnowledgeEntry,
  type KnowledgeFallback,
  type KnowledgeImport,
} from '@core/models/auto-reply-knowledge.model';
import { AutoReplyKnowledgeService, KNOWLEDGE_ACCEPT_ATTR } from '@core/services/auto-reply-knowledge.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { ErrorStateComponent } from '@shared/ui/state/error-state.component';
import { KnowledgeEntryListComponent } from './knowledge-entry-list.component';

type KnowledgeLoadState = 'loading' | 'ready' | 'error' | 'unsupported';

interface Preview {
  readonly fileName: string;
  readonly result: KnowledgeImport;
}

/**
 * What the assistant knows, as a filled-in spreadsheet.
 *
 * Download the template (dropdowns for the options), fill it in, upload it,
 * check the preview, save. Saving replaces everything, so the file stays the
 * single source of truth and "Download current" always round-trips.
 *
 * Saves on its own, separately from the auto-reply settings above it.
 */
@Component({
  selector: 'app-auto-reply-knowledge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CardComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    ErrorStateComponent,
    KnowledgeEntryListComponent,
  ],
  templateUrl: './auto-reply-knowledge.component.html',
})
export class AutoReplyKnowledgeComponent {
  private readonly service = inject(AutoReplyKnowledgeService);
  private readonly toast = inject(ToastService);

  /** False when the platform has no AI key: the file can be checked but not saved. */
  readonly configured = input(true);
  /** The old free-text instructions, still in use until a file replaces them. */
  readonly legacyNotes = input('');

  protected readonly acceptAttr = KNOWLEDGE_ACCEPT_ATTR;
  protected readonly kinds = KNOWLEDGE_KINDS;
  protected readonly kindCopy = KNOWLEDGE_KIND_COPY;
  protected readonly fallbackOptions = KNOWLEDGE_FALLBACK_OPTIONS;
  protected readonly limits = KNOWLEDGE_LIMITS;

  protected readonly state = signal<KnowledgeLoadState>('loading');
  protected readonly saved = signal<AutoReplyKnowledge | null>(null);

  protected readonly preview = signal<Preview | null>(null);
  protected readonly reading = signal(false);
  protected readonly dragging = signal(false);
  protected readonly fileError = signal<string | null>(null);

  protected readonly fallback = signal<KnowledgeFallback>('handoff');
  protected readonly fallbackMessage = signal(DEFAULT_FALLBACK_MESSAGE);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly confirmingClear = signal(false);

  protected readonly savedEntries = computed(() => this.saved()?.entries ?? []);
  protected readonly savedCounts = computed(() => countByKind(this.savedEntries()));
  protected readonly hasLegacyNotes = computed(
    () => this.legacyNotes().trim() !== '' && this.savedEntries().length === 0,
  );
  protected readonly issuesShown = signal(false);

  protected readonly fallbackProblem = computed(() => {
    if (this.fallback() !== 'handoff') {
      return null;
    }
    const message = this.fallbackMessage().trim();
    if (message === '') {
      return 'Write the holding message, or choose "Say nothing".';
    }
    return message.length > KNOWLEDGE_LIMITS.fallbackMessageMax
      ? `Keep the holding message under ${KNOWLEDGE_LIMITS.fallbackMessageMax} characters.`
      : null;
  });

  protected readonly fallbackDirty = computed(() => {
    const saved = this.saved();
    return (
      saved !== null &&
      (saved.fallback !== this.fallback() || saved.fallbackMessage !== this.fallbackMessage())
    );
  });

  /** Why saving is off, or null when it is on. Shown under the button, not only as a greyed control. */
  protected readonly saveBlocker = computed(() => {
    if (this.state() === 'unsupported') {
      return 'Saving needs a server update that is not installed yet. Your file was checked, nothing was sent.';
    }
    if (!this.configured()) {
      return 'The AI assistant is not set up on this platform yet.';
    }
    return this.fallbackProblem();
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.service.get().subscribe({
      next: (knowledge) => {
        this.apply(knowledge);
        this.state.set('ready');
      },
      // 404: this API predates the endpoint. The template and file check still
      // work, so the card stays useful rather than turning into an error.
      error: (error: ApiError) => this.state.set(error.status === 404 ? 'unsupported' : 'error'),
    });
  }

  private apply(knowledge: AutoReplyKnowledge): void {
    this.saved.set(knowledge);
    this.fallback.set(knowledge.fallback);
    this.fallbackMessage.set(knowledge.fallbackMessage || DEFAULT_FALLBACK_MESSAGE);
  }

  protected downloadTemplate(): void {
    this.service.downloadTemplate();
  }

  /** The saved rows — or the old notes, so moving to the template loses nothing. */
  protected downloadCurrent(): void {
    const entries = this.savedEntries();
    const legacy = legacyNotesEntry(this.legacyNotes());
    if (entries.length > 0) {
      this.service.downloadCurrent(entries);
    } else if (legacy !== null) {
      this.service.downloadCurrent([legacy]);
    } else {
      this.service.downloadTemplate();
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files.item(0) ?? null;
    if (file !== null) {
      void this.read(file);
    }
  }

  protected onFileInput(event: Event): void {
    const element = event.target as HTMLInputElement;
    const file = element.files?.item(0) ?? null;
    // Cleared so picking the same file again, after fixing it, still fires.
    element.value = '';
    if (file !== null) {
      void this.read(file);
    }
  }

  private async read(file: File): Promise<void> {
    if (this.reading()) {
      return;
    }
    this.reading.set(true);
    this.fileError.set(null);
    this.saveError.set(null);
    this.issuesShown.set(false);
    try {
      const result = await this.service.readFile(file);
      this.preview.set({ fileName: file.name, result });
      if (result.entries.length === 0 && result.issues.length === 0) {
        this.fileError.set('The file has no rows under the header. Fill in the Knowledge sheet and upload it again.');
        this.preview.set(null);
      }
    } catch (error) {
      this.preview.set(null);
      this.fileError.set(
        error instanceof KnowledgeFileError ? error.message : 'That file could not be read. Try saving it again.',
      );
    } finally {
      this.reading.set(false);
    }
  }

  protected cancelPreview(): void {
    this.preview.set(null);
    this.saveError.set(null);
  }

  protected savePreview(): void {
    const preview = this.preview();
    if (preview !== null && preview.result.entries.length > 0) {
      this.persist(preview.result.entries, preview.fileName, 'upload');
    }
  }

  protected saveFallback(): void {
    const saved = this.saved();
    if (saved !== null) {
      this.persist(saved.entries, saved.sourceFileName, 'fallback');
    }
  }

  protected resetFallback(): void {
    const saved = this.saved();
    if (saved !== null) {
      this.fallback.set(saved.fallback);
      this.fallbackMessage.set(saved.fallbackMessage || DEFAULT_FALLBACK_MESSAGE);
    }
  }

  private persist(entries: readonly KnowledgeEntry[], sourceFileName: string | null, reason: 'upload' | 'fallback'): void {
    if (this.saving() || this.saveBlocker() !== null) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);

    this.service
      .save({
        entries,
        fallback: this.fallback(),
        fallbackMessage: this.fallbackMessage().trim(),
        sourceFileName,
      })
      .subscribe({
        next: (knowledge) => {
          this.saving.set(false);
          this.apply(knowledge);
          this.preview.set(null);
          this.toast.success(
            reason === 'upload' ? 'Knowledge updated' : 'Saved',
            reason === 'upload'
              ? `The assistant now answers from ${knowledge.entries.length} ${knowledge.entries.length === 1 ? 'entry' : 'entries'}.`
              : 'Questions it cannot answer are handled the new way.',
          );
        },
        error: (error: ApiError) => {
          this.saving.set(false);
          const first = Object.values(error.fieldErrors ?? {})[0]?.[0];
          this.saveError.set(
            error.status === 422
              ? (first ?? 'Some rows were refused. Check the file and try again.')
              : error.status === 403
                ? 'Your plan does not include AI features.'
                : error.status === 404
                  ? 'Saving needs a server update that is not installed yet.'
                  : 'Could not save. Nothing has changed — please try again.',
          );
        },
      });
  }

  protected clear(): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.service.clear().subscribe({
      next: () => {
        this.saving.set(false);
        this.confirmingClear.set(false);
        this.saved.update((current) =>
          current === null ? null : { ...current, entries: [], sourceFileName: null },
        );
        // DELETE is a 204; the API records who cleared it and when, so read that back.
        this.service.get().subscribe({ next: (knowledge) => this.apply(knowledge), error: () => undefined });
        this.toast.success('Knowledge removed', 'The assistant has no business details to answer from now.');
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set('Could not remove it. Please try again.');
      },
    });
  }

  protected entryWord(count: number): string {
    return count === 1 ? 'entry' : 'entries';
  }
}
