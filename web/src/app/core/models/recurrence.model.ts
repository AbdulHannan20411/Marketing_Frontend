/**
 * Campaign scheduling.
 *
 * The shape follows iCalendar's RRULE closely enough that a backend can map it
 * onto a real scheduler without a translation layer, but stays flat and
 * JSON-friendly rather than adopting RRULE's string grammar — which no form can
 * validate field by field, and which no reviewer can read at a glance.
 */

export type RecurrenceFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Two ways to say "monthly": the 15th, or the third Wednesday. */
export type MonthlyMode = 'dayOfMonth' | 'dayOfWeek';

export type WeekOrdinal = 'first' | 'second' | 'third' | 'fourth' | 'last';

export type EndCondition = 'never' | 'onDate' | 'afterCount';

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  /** "Every N days/weeks/months/years". Ignored for `once`. */
  readonly interval: number;
  /** 0 = Sunday … 6 = Saturday. Weekly only; at least one required. */
  readonly weekdays: readonly number[];
  readonly monthlyMode: MonthlyMode;
  /** 1–31. `dayOfMonth` mode; also the day for `yearly`. */
  readonly dayOfMonth: number;
  readonly ordinal: WeekOrdinal;
  /** 0–6, paired with `ordinal` for "third Wednesday". */
  readonly ordinalWeekday: number;
  /** 1–12. Yearly only. */
  readonly month: number;
  /** `yyyy-MM-dd` in the campaign's timezone, not UTC. */
  readonly startDate: string;
  /** `HH:mm`, 24-hour, in the campaign's timezone. */
  readonly time: string;
  /** IANA zone, e.g. `Europe/London`. Never a fixed offset — DST would drift. */
  readonly timeZone: string;
  readonly endCondition: EndCondition;
  /** `yyyy-MM-dd`. Used when `endCondition` is `onDate`. */
  readonly endDate: string | null;
  /** Used when `endCondition` is `afterCount`. */
  readonly occurrenceCount: number | null;
}

export const WEEKDAY_LABELS: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const WEEKDAY_SHORT: readonly string[] = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const MONTH_LABELS: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const ORDINAL_LABELS: Readonly<Record<WeekOrdinal, string>> = {
  first: 'First',
  second: 'Second',
  third: 'Third',
  fourth: 'Fourth',
  last: 'Last',
};

export const FREQUENCY_LABELS: Readonly<Record<RecurrenceFrequency, string>> = {
  once: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/**
 * The browser's zone.
 *
 * Never hard-code one: a campaign scheduled for "9am" means 9am where the
 * business is, and a fixed offset would drift by an hour twice a year.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Every IANA zone the runtime knows, or a short fallback on older browsers. */
export function supportedTimeZones(): readonly string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;

  if (typeof supported === 'function') {
    try {
      return supported('timeZone');
    } catch {
      // Falls through to the short list below.
    }
  }

  return [
    'UTC',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Madrid',
    'Asia/Karachi',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Australia/Sydney',
  ];
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function defaultRecurrence(): RecurrenceRule {
  const now = new Date();
  return {
    frequency: 'once',
    interval: 1,
    weekdays: [now.getDay()],
    monthlyMode: 'dayOfMonth',
    dayOfMonth: now.getDate(),
    ordinal: 'first',
    ordinalWeekday: now.getDay(),
    month: now.getMonth() + 1,
    startDate: todayIso(),
    time: '09:00',
    timeZone: browserTimeZone(),
    endCondition: 'never',
    endDate: null,
    occurrenceCount: null,
  };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** `09:00` becomes `9:00 AM`, without dragging in a date library. */
export function formatTime(time: string): string {
  const [hoursText, minutesText] = time.split(':');
  const hours = Number(hoursText);
  if (Number.isNaN(hours)) {
    return time;
  }
  const suffix = hours < 12 ? 'AM' : 'PM';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutesText} ${suffix}`;
}

/** `2026-09-05` becomes `September 5, 2026`. Parsed as local, never UTC. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return date;
  }
  return `${MONTH_LABELS[month - 1]} ${day}, ${year}`;
}

function ordinalSuffix(value: number): string {
  if (value % 100 >= 11 && value % 100 <= 13) {
    return `${value}th`;
  }
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function listWeekdays(weekdays: readonly number[]): string {
  const names = [...weekdays].sort((a, b) => a - b).map((day) => WEEKDAY_LABELS[day]);
  if (names.length === 0) {
    return 'no days';
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function endClause(rule: RecurrenceRule): string {
  if (rule.endCondition === 'onDate' && rule.endDate !== null && rule.endDate !== '') {
    return `, until ${formatDate(rule.endDate)}`;
  }
  if (rule.endCondition === 'afterCount' && rule.occurrenceCount !== null) {
    return `, ${rule.occurrenceCount} ${rule.occurrenceCount === 1 ? 'time' : 'times'}`;
  }
  return '';
}

/**
 * One sentence describing the whole rule.
 *
 * This is what the reviewer reads before activating, so it has to be true — it
 * is generated from the same fields the backend receives, never from the form's
 * presentation state.
 */
export function describeRecurrence(rule: RecurrenceRule): string {
  const at = `at ${formatTime(rule.time)}`;
  const from = formatDate(rule.startDate);
  const every = rule.interval > 1 ? `${rule.interval} ` : '';

  switch (rule.frequency) {
    case 'once':
      return `Sends once on ${from} ${at}.`;

    case 'daily':
      return `Repeats every ${every}${rule.interval === 1 ? 'day' : 'days'} ${at}, starting ${from}${endClause(rule)}.`;

    case 'weekly':
      return `Repeats every ${every}${rule.interval === 1 ? 'week' : 'weeks'} on ${listWeekdays(rule.weekdays)} ${at}, starting ${from}${endClause(rule)}.`;

    case 'monthly': {
      const when =
        rule.monthlyMode === 'dayOfMonth'
          ? `on the ${ordinalSuffix(rule.dayOfMonth)}`
          : `on the ${ORDINAL_LABELS[rule.ordinal].toLowerCase()} ${WEEKDAY_LABELS[rule.ordinalWeekday]}`;
      const months = rule.interval === 1 ? 'every month' : `every ${rule.interval} months`;
      return `Repeats ${when} of ${months} ${at}, starting ${from}${endClause(rule)}.`;
    }

    case 'yearly': {
      const years = rule.interval === 1 ? 'every year' : `every ${rule.interval} years`;
      return `Repeats ${years} on ${MONTH_LABELS[rule.month - 1]} ${rule.dayOfMonth} ${at}, starting ${from}${endClause(rule)}.`;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface RecurrenceProblem {
  readonly field: string;
  readonly message: string;
}

/**
 * Everything the scheduler would refuse, checked here first.
 *
 * Returns every problem rather than the first: a form that reveals one fault at
 * a time makes the user submit repeatedly to discover them all.
 */
export function validateRecurrence(rule: RecurrenceRule): readonly RecurrenceProblem[] {
  const problems: RecurrenceProblem[] = [];

  if (rule.startDate === '') {
    problems.push({ field: 'startDate', message: 'Choose a start date.' });
  }
  if (rule.time === '') {
    problems.push({ field: 'time', message: 'Choose a time.' });
  }
  if (rule.timeZone === '') {
    problems.push({ field: 'timeZone', message: 'Choose a timezone.' });
  }

  if (rule.frequency === 'once') {
    return problems;
  }

  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    problems.push({ field: 'interval', message: 'Repeat every 1 or more.' });
  }
  if (rule.frequency === 'weekly' && rule.weekdays.length === 0) {
    problems.push({ field: 'weekdays', message: 'Pick at least one day of the week.' });
  }
  if (
    (rule.frequency === 'monthly' && rule.monthlyMode === 'dayOfMonth') ||
    rule.frequency === 'yearly'
  ) {
    if (rule.dayOfMonth < 1 || rule.dayOfMonth > 31) {
      problems.push({ field: 'dayOfMonth', message: 'Day must be between 1 and 31.' });
    }
  }
  if (rule.frequency === 'yearly' && (rule.month < 1 || rule.month > 12)) {
    problems.push({ field: 'month', message: 'Choose a month.' });
  }

  if (rule.endCondition === 'onDate') {
    if (rule.endDate === null || rule.endDate === '') {
      problems.push({ field: 'endDate', message: 'Choose an end date.' });
    } else if (rule.startDate !== '' && rule.endDate < rule.startDate) {
      problems.push({ field: 'endDate', message: 'The end date cannot be before the start.' });
    }
  }
  if (rule.endCondition === 'afterCount') {
    if (rule.occurrenceCount === null || rule.occurrenceCount < 1) {
      problems.push({ field: 'occurrenceCount', message: 'Run at least once.' });
    }
  }

  return problems;
}

/**
 * A short warning for months that do not have the chosen day.
 *
 * Not an error — schedulers usually clamp to the last day — but the operator
 * should know that "the 31st" will not fire every month.
 */
export function monthlyDayWarning(rule: RecurrenceRule): string | null {
  if (rule.frequency !== 'monthly' || rule.monthlyMode !== 'dayOfMonth') {
    return null;
  }
  if (rule.dayOfMonth === 31) {
    return 'Months with fewer than 31 days will run on their last day instead.';
  }
  if (rule.dayOfMonth === 30) {
    return 'February will run on its last day instead.';
  }
  if (rule.dayOfMonth === 29) {
    return 'February will run on the 28th outside a leap year.';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * First occurrence
 *
 * Shown next to the summary when `interval > 1`, because that is where the
 * anchoring rule surprises people: "every 2 weeks on Monday" starting on a
 * Saturday first fires eleven days later, not two.
 *
 * The API is the authority — `nextRunAt` comes back from `schedule` — so this
 * is a preview only. It follows the documented rules exactly: eligible weeks
 * are the start date's own week and every Nth week after it, short months
 * clamp, and `last` means the final matching weekday.
 * ------------------------------------------------------------------ */

function atLocalNoon(year: number, month: number, day: number): Date {
  // Noon avoids a date sliding either side of midnight under DST.
  return new Date(year, month, day, 12, 0, 0, 0);
}

function parseLocalDate(date: string): Date | null {
  const [year, month, day] = date.split('-').map(Number);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }
  return atLocalNoon(year, month - 1, day);
}

function toIsoDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** The Sunday that begins the week containing `value`. */
function startOfWeek(value: Date): Date {
  const result = new Date(value);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

/** Resolves "third Wednesday" / "last Friday" within one month. */
function ordinalWeekdayOf(
  year: number,
  monthIndex: number,
  ordinal: WeekOrdinal,
  weekday: number,
): Date {
  if (ordinal === 'last') {
    const last = atLocalNoon(year, monthIndex, daysInMonth(year, monthIndex));
    const shift = (last.getDay() - weekday + 7) % 7;
    last.setDate(last.getDate() - shift);
    return last;
  }

  const index = { first: 0, second: 1, third: 2, fourth: 3 }[ordinal];
  const first = atLocalNoon(year, monthIndex, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  return atLocalNoon(year, monthIndex, 1 + shift + index * 7);
}

/**
 * The first date this rule fires on or after its start date, as `yyyy-MM-dd`.
 *
 * Returns `null` when the rule cannot produce one — a weekly rule with no days
 * selected, or a malformed start date.
 */
export function firstOccurrenceDate(rule: RecurrenceRule): string | null {
  const start = parseLocalDate(rule.startDate);
  if (start === null) {
    return null;
  }

  const interval = Math.max(1, rule.interval);

  switch (rule.frequency) {
    case 'once':
    case 'daily':
      return toIsoDate(start);

    case 'weekly': {
      if (rule.weekdays.length === 0) {
        return null;
      }
      // Eligible weeks are the start date's own week, then every Nth after it.
      // A weekday earlier in that first week falls before the start and is not
      // eligible, which is what pushes "every 2 weeks" out by a full cycle.
      const anchor = startOfWeek(start);
      const ordered = [...rule.weekdays].sort((a, b) => a - b);

      for (let cycle = 0; cycle < 520; cycle++) {
        const weekStart = new Date(anchor);
        weekStart.setDate(weekStart.getDate() + cycle * interval * 7);

        for (const weekday of ordered) {
          const candidate = new Date(weekStart);
          candidate.setDate(candidate.getDate() + weekday);
          if (candidate >= start) {
            return toIsoDate(candidate);
          }
        }
      }
      return null;
    }

    case 'monthly': {
      for (let step = 0; step < 240; step++) {
        const cursor = new Date(start.getFullYear(), start.getMonth() + step * interval, 1, 12);
        const candidate =
          rule.monthlyMode === 'dayOfWeek'
            ? ordinalWeekdayOf(
                cursor.getFullYear(),
                cursor.getMonth(),
                rule.ordinal,
                rule.ordinalWeekday,
              )
            : atLocalNoon(
                cursor.getFullYear(),
                cursor.getMonth(),
                // Short months clamp rather than skipping.
                Math.min(rule.dayOfMonth, daysInMonth(cursor.getFullYear(), cursor.getMonth())),
              );

        if (candidate >= start) {
          return toIsoDate(candidate);
        }
      }
      return null;
    }

    case 'yearly': {
      for (let step = 0; step < 100; step++) {
        const year = start.getFullYear() + step * interval;
        const monthIndex = rule.month - 1;
        const candidate = atLocalNoon(
          year,
          monthIndex,
          Math.min(rule.dayOfMonth, daysInMonth(year, monthIndex)),
        );
        if (candidate >= start) {
          return toIsoDate(candidate);
        }
      }
      return null;
    }
  }
}

/** `September 14, 2026` for the first firing, or `null`. */
export function describeFirstOccurrence(rule: RecurrenceRule): string | null {
  const date = firstOccurrenceDate(rule);
  return date === null ? null : formatDate(date);
}

/**
 * Whether the first firing is later than the start date.
 *
 * Only then is it worth showing — for a rule that fires on its start date the
 * extra line says nothing.
 */
export function firstOccurrenceIsLater(rule: RecurrenceRule): boolean {
  const first = firstOccurrenceDate(rule);
  return first !== null && first !== rule.startDate;
}

/**
 * A UTC instant rendered in a named zone — `13 Oct 2026, 9:00 AM`.
 *
 * `nextRunAt` and `lastRunAt` come back as UTC, but a campaign scheduled for
 * "9am in Europe/London" must read as 9am to whoever set it, wherever they
 * happen to be sitting. Formatting in the browser's zone would show an operator
 * in Karachi a 1:00 PM run they never asked for.
 */
export function formatInstant(instant: string, timeZone: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    return instant;
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsed);
  } catch {
    // An unknown zone must not blank the field; fall back to the browser's.
    return parsed.toLocaleString();
  }
}

/** `Mon 13 Oct` — the compact form for a table cell. */
export function formatInstantShort(instant: string, timeZone: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    return instant;
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsed);
  } catch {
    return parsed.toLocaleString();
  }
}
