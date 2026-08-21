import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import type {
  EndCondition,
  MonthlyMode,
  RecurrenceFrequency,
  RecurrenceRule,
  WeekOrdinal,
} from '@core/models/recurrence.model';
import {
  FREQUENCY_LABELS,
  MONTH_LABELS,
  ORDINAL_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  browserTimeZone,
  defaultRecurrence,
  describeFirstOccurrence,
  describeRecurrence,
  firstOccurrenceIsLater,
  monthlyDayWarning,
  supportedTimeZones,
  validateRecurrence,
} from '@core/models/recurrence.model';
import { PositiveNumberDirective } from '@shared/directives/positive-number.directive';
import { IconComponent } from '@shared/ui/icon/icon.component';

const FREQUENCIES: readonly RecurrenceFrequency[] = ['once', 'daily', 'weekly', 'monthly', 'yearly'];

/**
 * The schedule builder.
 *
 * Only the fields that matter to the chosen frequency are shown — a weekly
 * schedule has no use for "day of month", and leaving it visible invites the
 * operator to set a value that will be silently discarded.
 *
 * The summary underneath is generated from the same rule the parent receives,
 * so what the reviewer reads is what will actually be scheduled.
 */
@Component({
  selector: 'app-recurrence-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, IconComponent, PositiveNumberDirective],
  templateUrl: './recurrence-editor.component.html',
})
export class RecurrenceEditorComponent {
  /** Seeds the form. Later changes are ignored so typing is never interrupted. */
  readonly value = input<RecurrenceRule | null>(null);
  /** Reveals validation messages, so a pristine form is not scolded. */
  readonly showErrors = input(false);

  readonly changed = output<RecurrenceRule>();

  private readonly formBuilder = inject(FormBuilder);

  protected readonly frequencies = FREQUENCIES;
  protected readonly frequencyLabels = FREQUENCY_LABELS;
  protected readonly weekdayLabels = WEEKDAY_LABELS;
  protected readonly weekdayShort = WEEKDAY_SHORT;
  protected readonly monthLabels = MONTH_LABELS;
  protected readonly ordinalLabels = ORDINAL_LABELS;
  protected readonly ordinals: readonly WeekOrdinal[] = [
    'first',
    'second',
    'third',
    'fourth',
    'last',
  ];
  protected readonly timeZones = supportedTimeZones();
  protected readonly detectedZone = browserTimeZone();

  protected readonly form = this.formBuilder.nonNullable.group({
    frequency: ['once' as RecurrenceFrequency],
    interval: [1, [Validators.required, Validators.min(1)]],
    monthlyMode: ['dayOfMonth' as MonthlyMode],
    dayOfMonth: [1, [Validators.min(1), Validators.max(31)]],
    ordinal: ['first' as WeekOrdinal],
    ordinalWeekday: [1],
    month: [1],
    startDate: ['', Validators.required],
    time: ['09:00', Validators.required],
    timeZone: ['', Validators.required],
    endCondition: ['never' as EndCondition],
    endDate: [''],
    occurrenceCount: [1],
  });

  /** Weekdays live outside the form: a chip row is not a form control. */
  protected readonly weekdays = signal<readonly number[]>([]);

  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** The single source of truth handed to the parent and to the summary. */
  protected readonly rule = computed<RecurrenceRule>(() => {
    // Read through the signal so the computed tracks every keystroke.
    this.formValue();
    const raw = this.form.getRawValue();

    return {
      frequency: raw.frequency,
      interval: Number(raw.interval) || 1,
      weekdays: this.weekdays(),
      monthlyMode: raw.monthlyMode,
      dayOfMonth: Number(raw.dayOfMonth) || 1,
      ordinal: raw.ordinal,
      ordinalWeekday: Number(raw.ordinalWeekday),
      month: Number(raw.month) || 1,
      startDate: raw.startDate,
      time: raw.time,
      timeZone: raw.timeZone,
      endCondition: raw.endCondition,
      endDate: raw.endCondition === 'onDate' ? raw.endDate : null,
      occurrenceCount:
        raw.endCondition === 'afterCount' ? Number(raw.occurrenceCount) || 1 : null,
    };
  });

  protected readonly frequency = computed(() => this.rule().frequency);
  protected readonly summary = computed(() => describeRecurrence(this.rule()));
  protected readonly problems = computed(() => validateRecurrence(this.rule()));
  protected readonly monthWarning = computed(() => monthlyDayWarning(this.rule()));

  /**
   * The first date this schedule actually fires, shown only when it is not the
   * start date.
   *
   * Weekly intervals anchor on the start date own week, so "every 2 weeks on
   * Monday" starting on a Saturday first fires eleven days later, not two. The
   * operator has no way to work that out from the sentence alone, and finding
   * out from the send log is too late.
   */
  protected readonly firstRun = computed(() => {
    const rule = this.rule();
    if (rule.frequency === 'once' || !firstOccurrenceIsLater(rule)) {
      return null;
    }
    return describeFirstOccurrence(rule);
  });

  protected readonly isZoneUnusual = computed(
    () => this.rule().timeZone !== '' && this.rule().timeZone !== this.detectedZone,
  );

  /**
   * The last rule this component emitted.
   *
   * The parent stores what we emit and feeds it back through `value`, so
   * without this the seeding effect would immediately overwrite the form with
   * the value the user just produced — every click reverting itself. Comparing
   * by identity is enough: anything we emitted is already in the form.
   */
  private lastEmitted: RecurrenceRule | null = null;

  constructor() {
    effect(() => {
      const seed = this.value();
      untracked(() => {
        if (seed !== null && seed === this.lastEmitted) {
          return;
        }
        this.reset(seed ?? defaultRecurrence());
      });
    });

    // Publish upward on every edit, including the weekday chips.
    effect(() => {
      const rule = this.rule();
      untracked(() => {
        this.lastEmitted = rule;
        this.changed.emit(rule);
      });
    });
  }

  private reset(rule: RecurrenceRule): void {
    this.form.setValue({
      frequency: rule.frequency,
      interval: rule.interval,
      monthlyMode: rule.monthlyMode,
      dayOfMonth: rule.dayOfMonth,
      ordinal: rule.ordinal,
      ordinalWeekday: rule.ordinalWeekday,
      month: rule.month,
      startDate: rule.startDate,
      time: rule.time,
      timeZone: rule.timeZone === '' ? this.detectedZone : rule.timeZone,
      endCondition: rule.endCondition,
      endDate: rule.endDate ?? '',
      occurrenceCount: rule.occurrenceCount ?? 1,
    });
    this.weekdays.set(rule.weekdays);
  }

  protected setFrequency(frequency: RecurrenceFrequency): void {
    this.form.controls.frequency.setValue(frequency);

    // A weekly schedule with no day selected cannot run; seed it from the start
    // date so the common case needs no extra click.
    if (frequency === 'weekly' && this.weekdays().length === 0) {
      const start = this.form.controls.startDate.value;
      const day = start === '' ? new Date().getDay() : new Date(`${start}T00:00:00`).getDay();
      this.weekdays.set([Number.isNaN(day) ? new Date().getDay() : day]);
    }
  }

  protected toggleWeekday(day: number): void {
    this.weekdays.update((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day],
    );
  }

  protected isWeekdaySelected(day: number): boolean {
    return this.weekdays().includes(day);
  }

  protected setEndCondition(condition: EndCondition): void {
    this.form.controls.endCondition.setValue(condition);
  }

  protected setMonthlyMode(mode: MonthlyMode): void {
    this.form.controls.monthlyMode.setValue(mode);
  }

  protected useDetectedZone(): void {
    this.form.controls.timeZone.setValue(this.detectedZone);
  }

  /** The message for one field, or null. Drives the inline errors. */
  protected problemFor(field: string): string | null {
    if (!this.showErrors()) {
      return null;
    }
    return this.problems().find((problem) => problem.field === field)?.message ?? null;
  }
}
