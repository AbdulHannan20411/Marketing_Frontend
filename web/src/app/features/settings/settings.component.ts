import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AuthService } from '@core/auth/auth.service';
import { USER_ROLE_LABEL } from '@core/models/auth.model';
import { ThemeService, type ThemePreference } from '@core/services/theme.service';
import { AvatarComponent } from '@shared/ui/avatar/avatar.component';
import { BadgeComponent } from '@shared/ui/badge/badge.component';
import { CardComponent } from '@shared/ui/card/card.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import type { IconName } from '@shared/ui/icon/icon.registry';
import { PageHeaderComponent } from '@shared/ui/page-header/page-header.component';

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
    IconComponent,
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
}
