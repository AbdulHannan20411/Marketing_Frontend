import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '@core/auth/auth.service';
import type { ApiError } from '@core/models/api.model';
import { USER_ROLE_LABEL } from '@core/models/auth.model';
import { meetsPasswordPolicy, passwordRules, passwordStrength } from '@core/models/password-policy';
import { OnboardingService } from '@core/services/onboarding.service';
import { ThemeService, type ThemePreference } from '@core/services/theme.service';
import { ToastService } from '@core/services/toast.service';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { ButtonDirective } from '@shared/ui/button/button.directive';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/ui/state/empty-state.component';
import { FAQ_ENTRIES, FAQ_TOPIC_LABEL, type FaqEntry, type FaqTopic } from './help-content';

type TopicFilter = FaqTopic | 'all';

const TOPIC_ORDER: readonly FaqTopic[] = [
  'templates',
  'campaigns',
  'contacts',
  'billing',
  'account',
];

/** Where "contact support" goes. One place to change it. */
const SUPPORT_EMAIL = 'support@nextreach.io';

/** Every field the profile form can report a message against. */
const PROFILE_FIELDS = [
  'displayName',
  'email',
  'newPassword',
  'confirmPassword',
  'currentPassword',
] as const;

interface ThemeOption {
  readonly value: ThemePreference;
  readonly label: string;
  readonly hint: string;
  readonly icon: IconName;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'light', label: 'Light', hint: 'Always the light palette.', icon: 'sparkles' },
  { value: 'dark', label: 'Dark', hint: 'Always the dark palette.', icon: 'eye' },
  { value: 'system', label: 'System', hint: 'Follows your device setting.', icon: 'cog' },
];

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    PageHeaderComponent,
    CardComponent,
    AvatarComponent,
    BadgeComponent,
    ButtonDirective,
    IconComponent,
    EmptyStateComponent,
  ],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly onboarding = inject(OnboardingService);

  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly preference = this.theme.preference;
  protected readonly isDark = this.theme.isDark;
  protected readonly user = this.auth.user;
  protected readonly roleLabel = USER_ROLE_LABEL;

  protected readonly resolvedLabel = computed(() =>
    this.preference() === 'system'
      ? `Following your device — currently ${this.isDark() ? 'dark' : 'light'}`
      : `Always ${this.preference()}`,
  );

  protected select(preference: ThemePreference): void {
    this.theme.set(preference);
  }

  /* ------------------------------ profile ------------------------------ */

  protected readonly editingProfile = signal(false);
  protected readonly savingProfile = signal(false);
  protected readonly showProfileErrors = signal(false);

  /** Field errors from the API, keyed exactly as the API sent them. */
  private readonly serverErrors = signal<Readonly<Record<string, readonly string[]>>>({});

  protected readonly profileForm = this.formBuilder.nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    newPassword: [''],
    confirmPassword: [''],
    currentPassword: [''],
  });

  private readonly profileValue = toSignal(this.profileForm.valueChanges, {
    initialValue: this.profileForm.getRawValue(),
  });

  constructor() {
    // Seed from the session, and re-seed when the profile reloads — but never
    // while the form is open, or a background refresh would discard typing.
    effect(() => {
      const current = this.user();
      untracked(() => {
        if (current !== null && !this.editingProfile()) {
          this.resetProfileForm();
        }
      });
    });
  }

  private resetProfileForm(): void {
    const current = this.user();
    this.profileForm.reset({
      displayName: current?.name ?? '',
      email: current?.email ?? '',
      newPassword: '',
      confirmPassword: '',
      currentPassword: '',
    });
    this.showProfileErrors.set(false);
    this.serverErrors.set({});
  }

  protected startEditingProfile(): void {
    this.resetProfileForm();
    this.editingProfile.set(true);
  }

  protected cancelEditingProfile(): void {
    this.editingProfile.set(false);
    this.resetProfileForm();
  }

  /* --------------------------- what is changing --------------------------- */

  protected readonly nameChanged = computed(() => {
    this.profileValue();
    return this.profileForm.controls.displayName.value.trim() !== (this.user()?.name ?? '');
  });

  protected readonly emailChanged = computed(() => {
    this.profileValue();
    const next = this.profileForm.controls.email.value.trim().toLowerCase();
    return next !== (this.user()?.email ?? '').toLowerCase();
  });

  protected readonly passwordChanging = computed(() => {
    this.profileValue();
    return this.profileForm.controls.newPassword.value !== '';
  });

  /**
   * Changing the address or the password needs the current password.
   *
   * Both are account-takeover steps, and a session left open on a shared
   * machine should not be enough to perform either. Renaming yourself is not,
   * so it does not ask.
   */
  protected readonly needsCurrentPassword = computed(
    () => this.emailChanged() || this.passwordChanging(),
  );

  protected readonly hasChanges = computed(
    () => this.nameChanged() || this.emailChanged() || this.passwordChanging(),
  );

  protected readonly newPasswordRules = computed(() => {
    this.profileValue();
    return passwordRules(this.profileForm.controls.newPassword.value);
  });

  protected readonly newPasswordStrength = computed(() => {
    this.profileValue();
    return passwordStrength(this.profileForm.controls.newPassword.value);
  });

  protected readonly passwordMismatch = computed(() => {
    this.profileValue();
    const raw = this.profileForm.getRawValue();
    return raw.confirmPassword !== '' && raw.confirmPassword !== raw.newPassword;
  });

  /* ------------------------------ validation ------------------------------ */

  /**
   * Reads an API field error regardless of casing.
   *
   * The API returns PascalCase keys — `CurrentPassword`, `NewPassword` — while
   * the form uses camelCase. Matching exactly would silently drop every inline
   * message and leave the user with nothing but a toast.
   */
  private serverError(field: string): string | null {
    const errors = this.serverErrors();
    const key = Object.keys(errors).find((entry) => entry.toLowerCase() === field.toLowerCase());
    return key === undefined ? null : (errors[key][0] ?? null);
  }

  protected profileProblem(field: string): string | null {
    const fromServer = this.serverError(field);
    if (fromServer !== null) {
      return fromServer;
    }
    if (!this.showProfileErrors()) {
      return null;
    }

    this.profileValue();
    const raw = this.profileForm.getRawValue();

    switch (field) {
      case 'displayName':
        return raw.displayName.trim() === '' ? 'A name is required.' : null;
      case 'email':
        return this.profileForm.controls.email.invalid ? 'Enter a valid email address.' : null;
      case 'newPassword':
        return this.passwordChanging() && !meetsPasswordPolicy(raw.newPassword)
          ? 'This password does not meet the rules below.'
          : null;
      case 'confirmPassword':
        if (this.passwordChanging() && raw.confirmPassword === '') {
          return 'Confirm the new password.';
        }
        return this.passwordMismatch() ? 'The two passwords do not match.' : null;
      case 'currentPassword':
        return this.needsCurrentPassword() && raw.currentPassword === ''
          ? 'Enter your current password to confirm this change.'
          : null;
      default:
        return null;
    }
  }

  /** Whether the form could be submitted, ignoring server errors already shown. */
  private isProfileValid(): boolean {
    const raw = this.profileForm.getRawValue();

    if (raw.displayName.trim() === '' || this.profileForm.controls.email.invalid) {
      return false;
    }
    if (this.passwordChanging()) {
      if (!meetsPasswordPolicy(raw.newPassword)) {
        return false;
      }
      if (raw.confirmPassword === '' || this.passwordMismatch()) {
        return false;
      }
    }
    return !this.needsCurrentPassword() || raw.currentPassword !== '';
  }

  /* ------------------------------- saving ------------------------------- */

  protected saveProfile(): void {
    this.showProfileErrors.set(true);
    this.serverErrors.set({});

    if (!this.hasChanges() || !this.isProfileValid() || this.savingProfile()) {
      return;
    }

    this.savingProfile.set(true);
    const raw = this.profileForm.getRawValue();

    // Captured before the request. A successful save reloads the session user,
    // so afterwards these comparisons are against the *new* values and every
    // one of them reads false — the confirmation would drop whatever it was
    // that actually changed.
    const changedDetails = this.nameChanged() || this.emailChanged();
    const changedPassword = this.passwordChanging();

    // One call, applied in one transaction. Name, email and password either all
    // take or none do, so there is no partial outcome to describe.
    this.auth
      .updateProfile({
        ...(this.nameChanged() ? { displayName: raw.displayName.trim() } : {}),
        ...(this.emailChanged() ? { email: raw.email.trim() } : {}),
        ...(changedPassword ? { newPassword: raw.newPassword } : {}),
        ...(this.needsCurrentPassword() ? { currentPassword: raw.currentPassword } : {}),
      })
      .subscribe({
        next: () => this.finishProfile(changedPassword, changedDetails),
        error: (error: ApiError) => this.failProfile(error),
      });
  }

  private finishProfile(passwordChanged: boolean, detailsChanged: boolean): void {
    this.savingProfile.set(false);
    this.editingProfile.set(false);
    this.resetProfileForm();

    const what = [
      detailsChanged ? 'Your details were updated' : null,
      passwordChanged ? 'your password was changed' : null,
    ]
      .filter((part) => part !== null)
      .join(' and ');

    this.toast.success(
      'Profile saved',
      passwordChanged ? `${what}. Other devices have been signed out.` : `${what}.`,
    );
  }

  private failProfile(error: ApiError): void {
    this.savingProfile.set(false);
    this.serverErrors.set(error.fieldErrors);

    // With field errors the message already sits beside the offending input; a
    // toast repeating it just doubles the noise.
    if (Object.keys(error.fieldErrors).length === 0) {
      this.toast.error(error.title, error.detail);
    }
  }

  protected readonly profileFields = PROFILE_FIELDS;

  /* ------------------------------ help & FAQ ------------------------------ */

  protected readonly topicLabels = FAQ_TOPIC_LABEL;
  protected readonly supportEmail = SUPPORT_EMAIL;

  /**
   * The whole panel is collapsed on arrival.
   *
   * Seventeen questions is a lot of page for something most visits do not need.
   * Settings is opened to change a setting; help is the exception, so it costs
   * one click and then stays open for as long as the page is.
   */
  protected readonly helpOpen = signal(false);

  protected readonly faqSearch = signal('');
  protected readonly faqTopic = signal<TopicFilter>('all');

  /**
   * Which answers are open.
   *
   * A set rather than a single id: someone comparing two answers should not
   * have the first collapse when they open the second.
   */
  private readonly openIds = signal<ReadonlySet<string>>(new Set());

  protected readonly topics: readonly { value: TopicFilter; label: string }[] = [
    { value: 'all', label: 'All topics' },
    ...TOPIC_ORDER.map((value) => ({ value, label: FAQ_TOPIC_LABEL[value] })),
  ];

  protected readonly visibleFaqs = computed<readonly FaqEntry[]>(() => {
    const term = this.faqSearch().trim().toLowerCase();
    const topic = this.faqTopic();

    return FAQ_ENTRIES.filter((entry) => {
      // Searching the answers matters as much as the questions: people describe
      // the symptom they are seeing, not the heading we filed it under.
      const matchesSearch =
        term === '' ||
        entry.question.toLowerCase().includes(term) ||
        entry.answer.some((paragraph) => paragraph.toLowerCase().includes(term));

      return matchesSearch && (topic === 'all' || entry.topic === topic);
    });
  });

  protected readonly isFaqFiltered = computed(
    () => this.faqSearch().trim() !== '' || this.faqTopic() !== 'all',
  );

  protected toggleHelp(): void {
    this.helpOpen.update((open) => !open);
  }

  /* ---------------------------- product tour ---------------------------- */

  /** How many steps this user's tour has — the same number the tour will show. */
  protected readonly tourStepCount = this.onboarding.total;

  /**
   * Restarts the tour and closes the help panel, so the first spotlight is not
   * hidden behind the thing that launched it.
   */
  protected restartTour(): void {
    this.helpOpen.set(false);
    this.onboarding.restart();
  }

  protected isOpen(id: string): boolean {
    return this.openIds().has(id);
  }

  protected toggleFaq(id: string): void {
    this.openIds.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  protected onFaqSearch(event: Event): void {
    this.faqSearch.set((event.target as HTMLInputElement).value);
  }

  protected setTopic(value: TopicFilter): void {
    this.faqTopic.set(value);
  }

  protected clearFaqFilters(): void {
    this.faqSearch.set('');
    this.faqTopic.set('all');
  }

  /**
   * Pre-fills the support email with who is asking and from where.
   *
   * Saves the first two round trips of every support thread — the workspace and
   * the account are what support asks for before they can look anything up.
   */
  protected readonly supportLink = computed(() => {
    const user = this.user();
    const subject = encodeURIComponent('NextReach support request');
    const body = encodeURIComponent(
      [
        'Describe the problem here.',
        '',
        '---',
        `Workspace: ${user?.workspaceName ?? 'unknown'}`,
        `Account: ${user?.email ?? 'unknown'}`,
        `Role: ${user === null ? 'unknown' : this.roleLabel[user.role]}`,
      ].join('\n'),
    );
    return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  });
}
