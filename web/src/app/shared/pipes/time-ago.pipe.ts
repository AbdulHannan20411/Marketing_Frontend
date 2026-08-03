import { Pipe, type PipeTransform } from '@angular/core';

const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const MONTH = DAY * 30;
const YEAR = DAY * 365;

/**
 * Renders an ISO timestamp as a relative phrase ("3 hours ago", "in 5 days").
 * Pure, so it re-evaluates only when the input reference changes.
 */
@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | null): string {
    if (value === null) {
      return '—';
    }

    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) {
      return '—';
    }

    const seconds = Math.round((timestamp - Date.now()) / 1000);
    const magnitude = Math.abs(seconds);

    const [amount, unit] =
      magnitude < MINUTE
        ? [seconds, 'second' as const]
        : magnitude < HOUR
          ? [Math.round(seconds / MINUTE), 'minute' as const]
          : magnitude < DAY
            ? [Math.round(seconds / HOUR), 'hour' as const]
            : magnitude < MONTH
              ? [Math.round(seconds / DAY), 'day' as const]
              : magnitude < YEAR
                ? [Math.round(seconds / MONTH), 'month' as const]
                : [Math.round(seconds / YEAR), 'year' as const];

    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(amount, unit);
  }
}
