export type ConnectionStatus = 'connected' | 'disconnected' | 'pending' | 'error';
export type QualityRating = 'green' | 'yellow' | 'red';

/**
 * Meta's messaging tier: how many unique customers may be started per day.
 *
 * Meta raises it automatically on volume and quality; it is not something the
 * customer or this platform can request, which is why the UI only reports it.
 */
export type MessagingTier = 'tier_250' | 'tier_1k' | 'tier_10k' | 'tier_100k' | 'unlimited';

export const MESSAGING_TIER_LABELS: Readonly<Record<MessagingTier, string>> = {
  tier_250: '250 / day',
  tier_1k: '1,000 / day',
  tier_10k: '10,000 / day',
  tier_100k: '100,000 / day',
  unlimited: 'Unlimited',
};

/* ------------------------------------------------------------------ *
 * Embedded Signup — server-side onboarding
 * ------------------------------------------------------------------ */

/**
 * What the server does after the popup closes.
 *
 * The popup is the fast half. `connect` exchanges the code, stores the
 * credential and returns; a scheduler then runs the remaining Meta round trips,
 * each of which takes seconds and fails for its own reason. A single spinner
 * over that window cannot say whether the number failed to register or the
 * webhook subscription did, and those have different remedies.
 */
export type OnboardingStep = 'token' | 'subscribe' | 'register' | 'profile';

/** Display order, and the order the server runs them in. */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'token',
  'subscribe',
  'register',
  'profile',
];

/**
 * `skipped` is not a failure.
 *
 * A number onboarded through Embedded Signup — and every Meta test number — is
 * already registered, and rejects a second registration. That is a step that
 * needed no doing, not a broken connection, and rendering it as an error makes
 * every test number look broken.
 */
export type OnboardingStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface OnboardingStepState {
  readonly step: OnboardingStep;
  readonly status: OnboardingStepStatus;
  /** Stable failure cause. Open set — unrecognised values fall back to generic. */
  readonly code: string | null;
  /** Meta's own words. Operator detail for a support ticket, never primary copy. */
  readonly message: string | null;
  readonly completedAt: string | null;
}

/**
 * Always present, even when nothing was ever attempted — an idle set rather
 * than an absence, so there is one shape to render instead of a branch.
 */
export interface ConnectionOnboarding {
  /**
   * Whether the server is still working.
   *
   * **Poll on this, never on the step array.** It comes from the connection's
   * own status; deriving "am I finished" from the steps means eventually
   * disagreeing with the server about when to stop.
   */
  readonly running: boolean;
  readonly currentStep: OnboardingStep | null;
  /** All four, from the first response, including ones not yet started. */
  readonly steps: readonly OnboardingStepState[];
}

export const ONBOARDING_STEP_LABEL: Readonly<Record<OnboardingStep, string>> = {
  token: 'Verifying authorisation',
  subscribe: 'Subscribing to delivery updates',
  register: 'Registering your phone number',
  profile: 'Loading your business profile',
};

/** One line of *why this step exists*, for the admin watching it run. */
export const ONBOARDING_STEP_DETAIL: Readonly<Record<OnboardingStep, string>> = {
  token: 'Exchanging the code Meta returned for a long-lived credential.',
  subscribe: 'Without this, messages send but no delivery status ever comes back.',
  register: 'Enabling the number for sending on the Cloud API.',
  profile: 'Display name, quality rating and messaging tier.',
};

/**
 * What a skipped step means, per step.
 *
 * Worded as a fact rather than a warning. `register` is the one that actually
 * occurs in practice, and "Already registered" is the whole explanation.
 */
export const ONBOARDING_STEP_SKIPPED: Readonly<Record<OnboardingStep, string>> = {
  token: 'Already authorised',
  subscribe: 'Already subscribed',
  register: 'Already registered',
  profile: 'Already up to date',
};

/**
 * What the admin should *do*, per failure code.
 *
 * Client-side on purpose: copy that lives in the database cannot be changed
 * without a deployment and cannot be translated.
 *
 * The set is **open** — the server will add codes — so every lookup goes
 * through {@link onboardingRemedy}, which falls back rather than rendering an
 * empty panel for a code this build has never heard of.
 */
export const ONBOARDING_REMEDIES: Readonly<Record<string, string>> = {
  token_rejected: 'Your connection has expired. Reconnect to continue.',
  subscribe_refused:
    "Meta would not grant access to this account's updates. Check the app has whatsapp_business_management permission, then reconnect.",
  register_refused:
    'The number could not be registered. Check it is not connected to another WhatsApp account.',
  profile_unreadable:
    'The number was linked but Meta would not return its details. Check the number is verified in Business Manager.',
  onboarding_failed: 'Onboarding could not be completed. Try connecting again.',
};

export const ONBOARDING_GENERIC_REMEDY =
  'Onboarding could not be completed. Try connecting again, and contact support if it persists.';

/** Never returns empty: an unknown code is still a failure that needs a remedy. */
export function onboardingRemedy(code: string | null): string {
  if (code === null || code === '') {
    return ONBOARDING_GENERIC_REMEDY;
  }
  return ONBOARDING_REMEDIES[code] ?? ONBOARDING_GENERIC_REMEDY;
}

/** The idle set, for a server too old to send one. */
export const IDLE_ONBOARDING: ConnectionOnboarding = {
  running: false,
  currentStep: null,
  steps: ONBOARDING_STEPS.map((step) => ({
    step,
    status: 'pending' as const,
    code: null,
    message: null,
    completedAt: null,
  })),
};

/** The step that stopped, or `null`. At most one can be failed at a time. */
export function failedStep(onboarding: ConnectionOnboarding): OnboardingStepState | null {
  return onboarding.steps.find((entry) => entry.status === 'failed') ?? null;
}

export interface WhatsAppConnection {
  readonly status: ConnectionStatus;
  readonly displayPhoneNumber: string;
  readonly verifiedName: string;
  readonly businessProfileAbout: string;
  readonly businessCategory: string;
  readonly qualityRating: QualityRating;
  /** Rolling 24-hour send ceiling granted by Meta. */
  readonly messagingLimit: number;
  readonly messagesLast24h: number;
  /** Unique customers that may be started per day. Reported, never requested. */
  readonly messagingTier: MessagingTier;
  readonly connectedAt: string | null;
  readonly webhookHealthy: boolean;
  readonly templateNamespaceAlias: string;
  /**
   * When the stored credential stops working, or `null`.
   *
   * **`null` means no stated end, not "expired long ago".** A system-user
   * token — the manual-connect path — genuinely has no expiry, so treating an
   * absent date as a lapsed one would put a permanent red warning on the one
   * connection that can never lapse.
   */
  readonly tokenExpiresAt: string | null;
  /**
   * Server-side onboarding progress.
   *
   * Always sent, including for a connection nothing was ever attempted on —
   * which is why there is no `| null` here and no branch on absence at the
   * call sites. {@link IDLE_ONBOARDING} covers a server too old to send it.
   */
  readonly onboarding: ConnectionOnboarding;
}

export type TemplateStatus = 'approved' | 'pending' | 'rejected' | 'paused';
export type TemplateCategory = 'marketing' | 'utility' | 'authentication';

/** `all` is a real wire value, not the absence of a filter — see `TemplateQuery`. */
export type TemplateStatusFilter = TemplateStatus | 'all';
export type TemplateCategoryFilter = TemplateCategory | 'all';

export const TEMPLATE_STATUS_LABEL: Readonly<Record<TemplateStatus, string>> = {
  approved: 'Approved',
  pending: 'Pending',
  rejected: 'Rejected',
  paused: 'Paused',
};

export const TEMPLATE_CATEGORY_LABEL: Readonly<Record<TemplateCategory, string>> = {
  marketing: 'Marketing',
  utility: 'Utility',
  authentication: 'Authentication',
};

/**
 * Query for the templates list.
 *
 * `search` matches the name and the body copy — an operator hunting for the
 * template that mentions "shipped" is not going to remember it was called
 * `order_shipped_v3`.
 *
 * Filters send the literal `all` when cleared, matching the convention the
 * contacts endpoint already set, so the API never has to distinguish "absent"
 * from "cleared".
 */
export interface TemplateQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: TemplateStatusFilter;
  readonly category: TemplateCategoryFilter;
}

/**
 * The filters the status counts are computed under.
 *
 * Every filter **except status** applies. Status is excluded because the counts
 * are a breakdown *by* status — applying it would leave the selected chip
 * showing the total and every other chip at zero, which tells nobody anything.
 * Search and category are different dimensions and must apply, or the chips
 * claim templates that the current filters exclude.
 */
export type TemplateCountQuery = Pick<TemplateQuery, 'search' | 'category'>;

/**
 * Counts per status across everything matching `TemplateCountQuery` — not just
 * the current page.
 *
 * A page of ten cannot say how many templates are pending, and "3 pending" is
 * exactly the thing an operator opens this screen to find out.
 */
export interface TemplateStatusCounts {
  readonly total: number;
  readonly approved: number;
  readonly pending: number;
  readonly rejected: number;
  readonly paused: number;
}

export interface MessageTemplate {
  readonly id: string;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly status: TemplateStatus;
  readonly language: string;
  readonly headerText: string | null;
  /** Body copy with `{{1}}`-style placeholders left intact for highlighting. */
  readonly bodyText: string;
  readonly footerText: string | null;
  readonly variables: readonly string[];
  readonly buttons: readonly string[];
  readonly qualityScore: QualityRating;
  readonly timesUsed: number;
  readonly updatedAt: string;
  readonly rejectionReason: string | null;
}

/* ------------------------------------------------------------------ *
 * Template authoring
 * ------------------------------------------------------------------ */

export type TemplateHeaderKind = 'none' | 'text' | 'image' | 'video' | 'document';

/** Meta rejects anything longer, so the composer stops before submission does. */
export const TEMPLATE_LIMITS = {
  nameMaxLength: 512,
  headerMaxLength: 60,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  buttonLabelMaxLength: 25,
  maxButtons: 3,
} as const;

/** Lowercase, digits and underscores only — Meta's rule for template names. */
export const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]+$/;

export type TemplateButtonKind = 'quick_reply' | 'url' | 'phone_number';

export interface TemplateButtonDraft {
  readonly kind: TemplateButtonKind;
  readonly label: string;
  /** URL or phone number, depending on `kind`. Empty for a quick reply. */
  readonly value: string;
}

export interface TemplateDraft {
  readonly name: string;
  readonly category: TemplateCategory;
  readonly language: string;
  readonly headerKind: TemplateHeaderKind;
  readonly headerText: string;
  readonly bodyText: string;
  readonly footerText: string;
  readonly buttons: readonly TemplateButtonDraft[];
}

/** Pulls `{{1}}`, `{{2}}` … out of body copy, in the order Meta expects them. */
export function templateVariables(body: string): readonly string[] {
  const found = body.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  return [...new Set(found.map((token) => token.replace(/\s/g, '')))].sort();
}

/**
 * Meta requires placeholders to run 1..n with no gaps, and rejects a body that
 * is nothing but a placeholder. Returns the reason it would be rejected.
 */
export function templateBodyProblem(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed === '') {
    return 'The body cannot be empty.';
  }
  if (/^\{\{\s*\d+\s*\}\}$/.test(trimmed)) {
    return 'The body cannot be a single placeholder on its own.';
  }

  const numbers = templateVariables(body).map((token) => Number(token.replace(/[^\d]/g, '')));
  for (let index = 0; index < numbers.length; index++) {
    if (numbers[index] !== index + 1) {
      return `Placeholders must run 1 to ${numbers.length} with no gaps.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

export type MediaKind = 'image' | 'video' | 'document';

/**
 * What WhatsApp accepts, and the ceilings it enforces.
 *
 * Audio is deliberately absent: it is valid in a conversation reply but never
 * in a template or campaign, so the campaign picker cannot offer it.
 */
export const MEDIA_RULES: Readonly<
  Record<MediaKind, { readonly accept: string; readonly maxBytes: number; readonly label: string }>
> = {
  image: { accept: 'image/jpeg,image/png', maxBytes: 5 * 1024 * 1024, label: 'JPG or PNG, up to 5 MB' },
  video: { accept: 'video/mp4,video/3gpp', maxBytes: 16 * 1024 * 1024, label: 'MP4 or 3GP, up to 16 MB' },
  document: {
    accept: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    maxBytes: 100 * 1024 * 1024,
    label: 'PDF, Word or Excel, up to 100 MB',
  },
};

/** Only in a conversation reply — never a campaign. */
export const AUDIO_RULE = {
  accept: 'audio/aac,audio/mpeg,audio/mp4,audio/ogg',
  maxBytes: 16 * 1024 * 1024,
  label: 'AAC, MP3, M4A or OGG, up to 16 MB',
} as const;

/** An uploaded file, identified by the handle Meta returned. */
export interface MediaAsset {
  readonly id: string;
  readonly kind: MediaKind | 'audio';
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Authenticated URL for preview; fetch as a blob. */
  readonly url: string;
  readonly uploadedAt: string;
}

export function mediaRejectionReason(file: File, kind: MediaKind | 'audio'): string | null {
  const rule = kind === 'audio' ? AUDIO_RULE : MEDIA_RULES[kind];
  const accepted = rule.accept.split(',');

  if (!accepted.includes(file.type)) {
    return `${file.name} is not accepted. WhatsApp allows ${rule.label}.`;
  }
  if (file.size > rule.maxBytes) {
    return `${file.name} is larger than WhatsApp allows for ${kind} (${rule.label}).`;
  }
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Conversations — the 24-hour customer service window
 * ------------------------------------------------------------------ */

export type MessageDirection = 'inbound' | 'outbound';
export type MessageDeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageKind = 'text' | 'image' | 'video' | 'document' | 'audio' | 'template' | 'system';

export interface ConversationMessage {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly kind: MessageKind;
  readonly body: string;
  readonly media: MediaAsset | null;
  readonly status: MessageDeliveryStatus;
  readonly failureReason: string | null;
  /** Set on outbound template sends, so the thread can name what was used. */
  readonly templateName: string | null;
  readonly occurredAt: string;
}

export interface Conversation {
  readonly id: string;
  readonly contactId: string | null;
  readonly contactName: string;
  readonly phoneNumber: string;
  readonly lastMessagePreview: string;
  readonly lastMessageAt: string;
  readonly unreadCount: number;
  /**
   * When the free-form window closes. `null` once it already has.
   *
   * Meta reopens it for 24 hours each time the customer messages in; outside
   * it only an approved template may be sent.
   */
  readonly windowExpiresAt: string | null;
}

/** Milliseconds left in the window, or 0 when it is shut. */
export function windowRemainingMs(conversation: Conversation, now = Date.now()): number {
  if (conversation.windowExpiresAt === null) {
    return 0;
  }
  return Math.max(0, new Date(conversation.windowExpiresAt).getTime() - now);
}

export function isWindowOpen(conversation: Conversation, now = Date.now()): boolean {
  return windowRemainingMs(conversation, now) > 0;
}

/** `23h 41m` / `41m` / `4m`, matching how Meta talks about the window. */
export function formatWindowRemaining(ms: number): string {
  if (ms <= 0) {
    return 'Closed';
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

export interface SendMessageRequest {
  readonly conversationId: string;
  readonly kind: Extract<MessageKind, 'text' | 'image' | 'video' | 'document' | 'audio'>;
  readonly body: string;
  readonly mediaId: string | null;
}

/* ------------------------------------------------------------------ *
 * Credential expiry
 * ------------------------------------------------------------------ */

/**
 * How loudly an approaching expiry should be said.
 *
 * `lapsed` exists for completeness — the API turns a lapsed connection into
 * `status: 'error'`, so in practice the error state renders first — but the
 * calculation should not quietly report "expires in -3 days" if that ever
 * changes.
 */
export type ExpiryUrgency = 'none' | 'notice' | 'urgent' | 'lapsed';

export interface ConnectionExpiry {
  readonly urgency: ExpiryUrgency;
  /** Whole days remaining; negative once past. */
  readonly days: number;
  /** `expires in 6 days` · `expires tomorrow` · `expires today` · `has expired`. */
  readonly phrase: string;
}

/** More than this and nothing is said: it is not yet news. */
const EXPIRY_NOTICE_DAYS = 14;

/** Inside this, reconnecting stops being a chore and becomes urgent. */
const EXPIRY_URGENT_DAYS = 3;

/**
 * Whether an expiry is worth mentioning, and how.
 *
 * Returns `null` when there is nothing to say — no date, or far enough out
 * that a warning would just be noise the customer learns to ignore.
 *
 * The whole point is that they find out while reconnecting is a two-minute
 * job, rather than when a campaign fails with an opaque 401.
 */
export function connectionExpiry(
  tokenExpiresAt: string | null | undefined,
  now: Date = new Date(),
): ConnectionExpiry | null {
  if (tokenExpiresAt === null || tokenExpiresAt === undefined || tokenExpiresAt === '') {
    return null;
  }

  const expiry = new Date(tokenExpiresAt);
  if (Number.isNaN(expiry.getTime())) {
    return null;
  }

  const millis = expiry.getTime() - now.getTime();
  // Rounded down, so "1.9 days left" reads as tomorrow rather than two days.
  const days = Math.floor(millis / 86_400_000);

  if (millis <= 0) {
    return { urgency: 'lapsed', days, phrase: 'has expired' };
  }
  if (days > EXPIRY_NOTICE_DAYS) {
    return null;
  }

  const urgency: ExpiryUrgency = days < EXPIRY_URGENT_DAYS ? 'urgent' : 'notice';
  const phrase =
    days === 0 ? 'expires today' : days === 1 ? 'expires tomorrow' : `expires in ${days} days`;

  return { urgency, days, phrase };
}
