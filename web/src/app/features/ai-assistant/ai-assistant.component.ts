import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';

import {
  AI_PROMPT_EXAMPLES,
  AI_PROMPT_MAX_LENGTH,
  aiErrorMessage,
} from '@core/models/ai-assistant.model';
import type { ApiError } from '@core/models/api.model';
import { AiAssistantService } from '@core/services/ai-assistant.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '@shared/ui/skeleton/skeleton.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';

type GenerationState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Prompt in, marketing copy out.
 *
 * Deliberately stateless between visits: no history, no conversation memory.
 * Each Generate is one independent request.
 */
@Component({
  selector: 'app-ai-assistant',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    CardComponent,
    ButtonDirective,
    IconComponent,
    SkeletonComponent,
    EmptyStateComponent,
  ],
  templateUrl: './ai-assistant.component.html',
})
export class AiAssistantComponent {
  private readonly service = inject(AiAssistantService);
  private readonly toast = inject(ToastService);

  protected readonly breadcrumbs = [
    { label: 'Home', route: '/dashboard' },
    { label: 'AI Assistant', route: null },
  ];
  protected readonly examples = AI_PROMPT_EXAMPLES;
  protected readonly maxLength = AI_PROMPT_MAX_LENGTH;
  protected readonly skeletonLines = ['100%', '92%', '96%', '70%'];

  protected readonly prompt = signal('');
  protected readonly state = signal<GenerationState>('idle');
  protected readonly answer = signal('');
  protected readonly errorMessage = signal('');
  protected readonly copied = signal(false);

  protected readonly length = computed(() => this.prompt().length);
  protected readonly tooLong = computed(() => this.length() > AI_PROMPT_MAX_LENGTH);
  protected readonly canGenerate = computed(
    () => this.prompt().trim() !== '' && !this.tooLong() && this.state() !== 'loading',
  );
  protected readonly canClear = computed(() => this.prompt() !== '' || this.state() !== 'idle');

  private request: Subscription | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Leaving the page cancels an in-flight generation, which the API passes on to the provider.
    inject(DestroyRef).onDestroy(() => {
      this.request?.unsubscribe();
      clearTimeout(this.copiedTimer);
    });
  }

  protected useExample(example: string): void {
    this.prompt.set(example);
  }

  /** Ctrl/⌘ + Enter generates, so the keyboard never has to leave the text area. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.generate();
    }
  }

  protected generate(): void {
    if (!this.canGenerate()) {
      return;
    }

    this.request?.unsubscribe();
    this.state.set('loading');
    this.errorMessage.set('');
    this.copied.set(false);

    this.request = this.service.generate(this.prompt().trim()).subscribe({
      next: (response) => {
        this.answer.set(response.answer);
        this.state.set('success');
      },
      error: (error: ApiError) => {
        this.errorMessage.set(aiErrorMessage(error));
        this.state.set('error');
      },
    });
  }

  protected clear(): void {
    this.request?.unsubscribe();
    this.request = null;
    this.prompt.set('');
    this.answer.set('');
    this.errorMessage.set('');
    this.copied.set(false);
    this.state.set('idle');
  }

  protected copy(): void {
    const text = this.answer();
    if (text === '') {
      return;
    }

    navigator.clipboard.writeText(text).then(
      () => {
        this.copied.set(true);
        clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
        this.toast.success('Copied', 'The response is on your clipboard.');
      },
      () => this.toast.error('Could not copy', 'Select the text and copy it manually.'),
    );
  }
}
