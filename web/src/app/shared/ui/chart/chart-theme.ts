import { signal } from '@angular/core';

/**
 * Chart chrome colours, kept outside the CSS token system because ApexCharts
 * paints to canvas and cannot read CSS variables.
 *
 * This is a signal read *inside* the preset functions, which are themselves
 * called from each page's `computed()`. That makes every chart's options
 * recompute when the theme flips, without a single page needing to know the
 * theme exists.
 */
export interface ChartTheme {
  readonly grid: string;
  readonly label: string;
  readonly valueText: string;
  readonly tooltip: 'light' | 'dark';
}

const LIGHT: ChartTheme = {
  grid: '#e5e7eb',
  label: '#6b7280',
  valueText: '#1e293b',
  tooltip: 'light',
};

const DARK: ChartTheme = {
  grid: '#2a3648',
  label: '#8896aa',
  valueText: '#e8edf5',
  tooltip: 'dark',
};

export const chartTheme = signal<ChartTheme>(LIGHT);

export function setChartTheme(isDark: boolean): void {
  chartTheme.set(isDark ? DARK : LIGHT);
}
