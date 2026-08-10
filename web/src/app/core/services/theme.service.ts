import { Injectable, computed, effect, signal } from '@angular/core';

import { setChartTheme } from '@shared/ui/chart/chart-theme';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'vd.theme';

function readStored(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

/**
 * Owns the colour theme.
 *
 * The preference is written to `data-theme` on <html>, which is what the token
 * overrides in `styles.css` key off. `system` is a real third state rather than
 * a synonym for light — it tracks the OS and keeps tracking it as that changes.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');

  /** Re-read on OS change so `system` stays live without a reload. */
  private readonly systemPrefersDark = signal(this.media.matches);

  readonly preference = signal<ThemePreference>(readStored());

  /** What is actually on screen, with `system` resolved. */
  readonly isDark = computed(() =>
    this.preference() === 'system' ? this.systemPrefersDark() : this.preference() === 'dark',
  );

  readonly options: readonly { value: ThemePreference; label: string; hint: string }[] = [
    { value: 'light', label: 'Light', hint: 'Always the light palette.' },
    { value: 'dark', label: 'Dark', hint: 'Always the dark palette.' },
    { value: 'system', label: 'System', hint: 'Follows your device setting.' },
  ];

  constructor() {
    this.media.addEventListener('change', (event) =>
      this.systemPrefersDark.set(event.matches),
    );

    effect(() => {
      const preference = this.preference();
      document.documentElement.setAttribute('data-theme', preference);
      localStorage.setItem(STORAGE_KEY, preference);

      // Canvas charts cannot read CSS variables, so they are told separately.
      setChartTheme(this.isDark());
    });
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
  }

  /** Flips between light and dark, resolving `system` to its current result. */
  toggle(): void {
    this.preference.set(this.isDark() ? 'light' : 'dark');
  }
}
