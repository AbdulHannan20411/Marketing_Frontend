import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  DIALLING_COUNTRIES,
  MIN_PHONE_DIGITS,
  NATIONAL_FORMAT_WARNING,
  findCountry,
  hasExitPrefix,
  formatInternational,
  hasEnoughDigits,
  looksNational,
  toInternational,
} from '@core/models/phone.model';
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

  // One list, shared with the phone model, so every selectable country is
  // guaranteed to have a dialling code and the preview can always resolve.
  protected readonly countries = DIALLING_COUNTRIES;
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

  /**
   * Deliberately permissive about *shape*: the server owns real E.164 parsing,
   * and reformatting as somebody types fights the paste from their phone.
   */
  protected readonly phoneInvalid = computed(() => !hasEnoughDigits(this.phoneNumber()));

  protected readonly minDigits = MIN_PHONE_DIGITS;
  protected readonly nationalWarning = NATIONAL_FORMAT_WARNING;

  /** A leading zero is a national trunk prefix — see `phone.model.ts`. */
  protected readonly isNational = computed(() => looksNational(this.phoneNumber()));

  /** `00…` already carries its country code, so no country is needed to expand it. */
  protected readonly isExitPrefixed = computed(() => hasExitPrefix(this.phoneNumber()));

  protected readonly countryKnown = computed(() => findCountry(this.country()) !== null);

  /**
   * The only case the API refuses outright: a national number it cannot expand.
   * Blocking here saves a round trip and a field-level error for something the
   * user can see and fix immediately.
   */
  protected readonly countryRequired = computed(
    () => this.isNational() && !this.isExitPrefixed() && this.country().trim() === '',
  );

  /**
   * What will actually be stored.
   *
   * The single highest-value thing on this form: the number typed and the
   * number messaged are different, and showing the conversion makes that
   * visible rather than surprising. It also catches a wrong country instantly —
   * the preview shows a prefix the user does not recognise.
   */
  protected readonly savedAsPreview = computed(() => {
    if (!this.isNational() || !hasEnoughDigits(this.phoneNumber())) {
      return null;
    }
    const converted = toInternational(this.phoneNumber(), this.country());
    return converted === null ? null : formatInternational(converted);
  });

  protected readonly emailInvalid = computed(() => {
    const value = this.email().trim();
    return value.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  });

  protected readonly invalid = computed(
    () =>
      this.nameInvalid() || this.phoneInvalid() || this.emailInvalid() || this.countryRequired(),
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
