/**
 * AI auto-reply: the assistant answering customers on its own.
 *
 * Two maps decide what the screen offers. `triggers` is what the admin chose;
 * `allowedTriggers` is what the plan sells. A trigger the plan excludes is shown
 * disabled rather than hidden, so an admin can see what an upgrade buys.
 */

export const AUTO_REPLY_TRIGGERS = ['greeting', 'first_message', 'unanswered'] as const;

export type AutoReplyTrigger = (typeof AUTO_REPLY_TRIGGERS)[number];

/** Keys are the API's literal snake_case strings, not an enum. */
export type AutoReplyTriggerMap = Readonly<Record<AutoReplyTrigger, boolean>>;

export interface AutoReplySettings {
  readonly enabled: boolean;
  readonly triggers: AutoReplyTriggerMap;
  readonly allowedTriggers: AutoReplyTriggerMap;
  readonly delaySeconds: number;
  readonly unansweredAfterMinutes: number;
  readonly instructions: string;
  readonly maxPerConversationPerDay: number;
  /** `null` means no ceiling; `remainingThisPeriod` is then null too. */
  readonly monthlyLimit: number | null;
  readonly usedThisPeriod: number;
  readonly remainingThisPeriod: number | null;
  readonly periodEndsAt: string;
  /** False when the deployment has no AI key: everything else is inert. */
  readonly assistantConfigured: boolean;
}

/** The editable half. Everything else on `AutoReplySettings` is reported, not set. */
export interface AutoReplyDraft {
  readonly enabled: boolean;
  readonly triggers: AutoReplyTriggerMap;
  readonly delaySeconds: number;
  readonly unansweredAfterMinutes: number;
  readonly instructions: string;
  readonly maxPerConversationPerDay: number;
}

/** Mirrors the API's ranges, so a value it would refuse is stopped here first. */
export const AUTO_REPLY_RANGES = {
  delaySeconds: { min: 10, max: 1800 },
  unansweredAfterMinutes: { min: 5, max: 1440 },
  maxPerConversationPerDay: { min: 1, max: 20 },
  instructionsMaxLength: 2000,
} as const;

export const AUTO_REPLY_TRIGGER_COPY: Readonly<
  Record<AutoReplyTrigger, { readonly label: string; readonly description: string }>
> = {
  greeting: {
    label: 'Greeting only',
    description:
      'The message is nothing but a greeting — "hi", "hello", "salam". "Hi, where is my order?" is not a greeting and waits for a person.',
  },
  first_message: {
    label: 'First message in a conversation',
    description: 'The first message from a customer you have never spoken to, whatever it says.',
  },
  unanswered: {
    label: 'Nobody replied',
    description: 'Nobody from your team has answered at all after the wait below.',
  },
};

export function autoReplyProblems(draft: AutoReplyDraft): readonly string[] {
  const problems: string[] = [];
  const ranges = AUTO_REPLY_RANGES;

  if (!Number.isInteger(draft.delaySeconds) || draft.delaySeconds < ranges.delaySeconds.min || draft.delaySeconds > ranges.delaySeconds.max) {
    problems.push('The delay must be between 10 seconds and 30 minutes.');
  }
  if (
    !Number.isInteger(draft.unansweredAfterMinutes) ||
    draft.unansweredAfterMinutes < ranges.unansweredAfterMinutes.min ||
    draft.unansweredAfterMinutes > ranges.unansweredAfterMinutes.max
  ) {
    problems.push('The unanswered wait must be between 5 minutes and 24 hours.');
  }
  if (
    !Number.isInteger(draft.maxPerConversationPerDay) ||
    draft.maxPerConversationPerDay < ranges.maxPerConversationPerDay.min ||
    draft.maxPerConversationPerDay > ranges.maxPerConversationPerDay.max
  ) {
    problems.push('Replies per customer per day must be between 1 and 20.');
  }
  if (draft.instructions.length > ranges.instructionsMaxLength) {
    problems.push(`Instructions must be under ${ranges.instructionsMaxLength} characters.`);
  }
  if (draft.enabled && !AUTO_REPLY_TRIGGERS.some((trigger) => draft.triggers[trigger])) {
    problems.push('Choose at least one occasion, or turn auto-reply off.');
  }

  return problems;
}

/** `45 seconds`, `2 minutes`, `30 minutes` — how the delay reads in a sentence. */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** `45 minutes`, `5 hours` — the unanswered wait is entered in minutes. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = minutes / 60;
  const rounded = Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10;
  return `${rounded} hour${rounded === 1 ? '' : 's'}`;
}
