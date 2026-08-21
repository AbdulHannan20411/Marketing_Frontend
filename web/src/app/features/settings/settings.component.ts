import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { USER_ROLE_LABEL } from '@core/models/auth.model';
import { ThemeService, type ThemePreference } from '@core/services/theme.service';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';
import { ButtonDirective } from '@shared/ui/button/button.directive';
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

  /* ------------------------------ help & FAQ ------------------------------ */

  protected readonly topicLabels = FAQ_TOPIC_LABEL;
  protected readonly supportEmail = SUPPORT_EMAIL;

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
