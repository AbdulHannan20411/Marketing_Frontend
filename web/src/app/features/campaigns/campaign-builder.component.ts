import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import type { ApiError } from '@core/models/api.model';
import type { ContactGroup } from '@core/models/contact.model';
import type { MediaAsset, MediaKind, MessageTemplate } from '@core/models/whatsapp.model';
import { MEDIA_RULES, mediaRejectionReason, templateVariables } from '@core/models/whatsapp.model';
import type { CampaignDraft } from '@core/services/campaigns.service';
import { ToastService } from '@core/services/toast.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { RouterLink } from '@angular/router';

import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/**
 * Build a campaign around an approved template.
 *
 * Only approved templates are offered: Meta refuses to send anything else, so
 * a pending template in the picker would produce a campaign that fails at send
 * time, long after the person who built it has moved on.
 *
 * The media picker is deliberately narrow — image, video and document are the
 * only header types a template can carry. Audio is valid in a conversation
 * reply but never in a template, so it is not offered here at all.
 */
@Component({
  selector: 'app-campaign-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ModalComponent, ButtonDirective, IconComponent],
  templateUrl: './campaign-builder.component.html',
})
export class CampaignBuilderComponent {
  readonly templates = input.required<readonly MessageTemplate[]>();
  readonly groups = input.required<readonly ContactGroup[]>();
  readonly saving = input(false);

  readonly created = output<CampaignDraft>();
  readonly cancelled = output<void>();

  private readonly whatsapp = inject(WhatsAppService);
  private readonly toast = inject(ToastService);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('mediaInput');

  protected readonly name = signal('');
  protected readonly templateId = signal('');
  protected readonly groupIds = signal<readonly string[]>([]);
  protected readonly scheduledAt = signal('');
  protected readonly media = signal<MediaAsset | null>(null);
  protected readonly uploading = signal(false);
  protected readonly mediaError = signal<string | null>(null);

  /** The gate: Meta will not send a template it has not approved. */
  protected readonly approved = computed(() =>
    this.templates().filter((template) => template.status === 'approved'),
  );

  protected readonly awaitingReview = computed(
    () => this.templates().filter((template) => template.status === 'pending').length,
  );

  protected readonly selected = computed(
    () => this.approved().find((template) => template.id === this.templateId()) ?? null,
  );

  protected readonly variables = computed(() => {
    const template = this.selected();
    return template === null ? [] : templateVariables(template.bodyText);
  });

  /**
   * Which media the chosen template needs, if any.
   *
   * The stored template does not record its header type, so it is inferred:
   * a template with no header text but a media placeholder needs an upload.
   * Until the API returns `headerKind`, this stays a best guess and the picker
   * is offered rather than demanded.
   */
  protected readonly mediaKind = computed<MediaKind | null>(() => {
    const template = this.selected();
    if (template === null || template.headerText !== null) {
      return null;
    }
    return 'image';
  });

  protected readonly mediaRules = MEDIA_RULES;

  protected readonly audienceLabel = computed(() => {
    const chosen = this.groups().filter((group) => this.groupIds().includes(group.id));
    if (chosen.length === 0) {
      return 'All contacts';
    }
    return chosen.map((group) => group.name).join(', ');
  });

  protected readonly reach = computed(() => {
    const chosen = this.groups().filter((group) => this.groupIds().includes(group.id));
    return chosen.reduce((total, group) => total + group.contactCount, 0);
  });

  protected readonly invalid = computed(
    () => this.name().trim() === '' || this.selected() === null || this.uploading(),
  );

  protected toggleGroup(id: string): void {
    this.groupIds.update((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  protected selectTemplate(id: string): void {
    this.templateId.set(id);
    // A different template may want different media; a stale upload would ship.
    this.media.set(null);
    this.mediaError.set(null);
  }

  /* ------------------------------ media ------------------------------ */

  protected browse(): void {
    this.fileInput().nativeElement.click();
  }

  protected onMediaInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;
    input.value = '';

    const kind = this.mediaKind();
    if (file === null || kind === null) {
      return;
    }

    const reason = mediaRejectionReason(file, kind);
    if (reason !== null) {
      this.mediaError.set(reason);
      return;
    }

    this.mediaError.set(null);
    this.uploading.set(true);

    this.whatsapp.uploadMedia(file, kind).subscribe({
      next: (asset) => {
        this.uploading.set(false);
        this.media.set(asset);
      },
      error: (error: ApiError) => {
        this.uploading.set(false);
        this.toast.error(error.title, error.detail);
      },
    });
  }

  protected clearMedia(): void {
    this.media.set(null);
    this.mediaError.set(null);
  }

  protected submit(): void {
    const template = this.selected();
    if (this.invalid() || template === null || this.saving()) {
      return;
    }

    this.created.emit({
      name: this.name().trim(),
      templateId: template.id,
      audienceLabel: this.audienceLabel(),
      groupIds: this.groupIds(),
      mediaId: this.media()?.id ?? null,
      scheduledAt: this.scheduledAt() === '' ? null : new Date(this.scheduledAt()).toISOString(),
    });
  }
}
