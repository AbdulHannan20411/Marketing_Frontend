import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type {
  ContactGroup,
  ContactStatus,
  ContactTag,
  CreateContactRequest,
} from '@core/models/contact.model';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ModalComponent } from '@shared/ui/modal/modal.component';

/**
 * Countries offered in the picker. The API stores ISO alpha-2 and rejects a
 * display name, so the value must be the code. Leaving it blank lets the server
 * infer it from the dialling prefix, which is right far more often than not.
 */
const COUNTRIES: readonly { code: string; name: string }[] = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'PT', name: 'Portugal' },
  { code: 'PL', name: 'Poland' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'IN', name: 'India' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KE', name: 'Kenya' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
];

const STATUSES: readonly { value: ContactStatus; label: string; hint: string }[] = [
  { value: 'subscribed', label: 'Subscribed', hint: 'Consented — can be messaged.' },
  { value: 'unsubscribed', label: 'Unsubscribed', hint: 'Opted out; excluded from campaigns.' },
  { value: 'blocked', label: 'Blocked', hint: 'Never messaged. Needs a fresh opt-in to undo.' },
];

/** Create a single contact. Mirrors the API's validation so failures are rare. */
@Component({
  selector: 'app-contact-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent, ButtonDirective, IconComponent],
  templateUrl: './contact-editor.component.html',
})
export class ContactEditorComponent {
  readonly groups = input.required<readonly ContactGroup[]>();
  readonly tags = input.required<readonly ContactTag[]>();
  readonly saving = input(false);
  /** Field errors from a 422, keyed by field name. */
  readonly fieldErrors = input<Readonly<Record<string, readonly string[]>>>({});

  readonly save = output<CreateContactRequest>();
  readonly cancel = output<void>();

  protected readonly countries = COUNTRIES;
  protected readonly statuses = STATUSES;

  protected readonly fullName = signal('');
  protected readonly phoneNumber = signal('');
  protected readonly email = signal('');
  protected readonly country = signal('');
  protected readonly status = signal<ContactStatus>('subscribed');
  protected readonly selectedTags = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedGroups = signal<ReadonlySet<string>>(new Set());

  protected readonly nameInvalid = computed(() => {
    const value = this.fullName().trim();
    return value.length === 0 || value.length > 120;
  });

  /** Deliberately permissive: the server owns real E.164 parsing. */
  protected readonly phoneInvalid = computed(() => {
    const digits = this.phoneNumber().replace(/[^\d]/g, '');
    return digits.length < 6;
  });

  protected readonly emailInvalid = computed(() => {
    const value = this.email().trim();
    return value.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  });

  protected readonly invalid = computed(
    () => this.nameInvalid() || this.phoneInvalid() || this.emailInvalid(),
  );

  protected errorFor(field: string): string | null {
    return this.fieldErrors()[field]?.[0] ?? null;
  }

  protected toggleTag(id: string): void {
    this.selectedTags.update((current) => toggle(current, id));
  }

  protected toggleGroup(id: string): void {
    this.selectedGroups.update((current) => toggle(current, id));
  }

  protected isTagSelected(id: string): boolean {
    return this.selectedTags().has(id);
  }

  protected isGroupSelected(id: string): boolean {
    return this.selectedGroups().has(id);
  }

  protected submit(): void {
    if (this.invalid() || this.saving()) {
      return;
    }

    const email = this.email().trim();
    const country = this.country();

    this.save.emit({
      fullName: this.fullName().trim(),
      phoneNumber: this.phoneNumber().trim(),
      email: email.length === 0 ? null : email,
      // Omitted rather than empty, so the server infers from the number.
      ...(country.length === 0 ? {} : { country }),
      status: this.status(),
      tagIds: [...this.selectedTags()],
      groupIds: [...this.selectedGroups()],
    });
  }
}

function toggle(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}
