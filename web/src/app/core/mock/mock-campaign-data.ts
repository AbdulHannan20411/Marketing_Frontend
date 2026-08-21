import type {
  Campaign,
  CampaignMetrics,
  CampaignRun,
  CampaignRunStatus,
} from '@core/models/campaign.model';
import type { RecurrenceRule } from '@core/models/recurrence.model';
import { firstOccurrenceDate } from '@core/models/recurrence.model';
import { CAMPAIGNS, CONTACTS } from './mock-data';

/**
 * Stateful campaigns for the mock.
 *
 * Create, edit, duplicate and the lifecycle actions all mutate this store, so
 * the wizard can be driven end to end. `duplicate`, `resume` and reading a
 * single campaign are **not** in the real API yet — they are served here so the
 * UI is exercisable, and the gap is recorded in
 * `docs/API-CAMPAIGN-SCHEDULING.md` rather than hidden.
 */
export const campaignStore: Campaign[] = CAMPAIGNS.map((entry) => ({ ...entry }));

const EMPTY_METRICS = {
  audienceSize: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  clicked: 0,
  failed: 0,
  skipped: 0,
} as const;

export interface MockCampaignDraft {
  readonly name: string;
  readonly description?: string;
  readonly templateId: string;
  readonly audienceLabel: string;
  readonly groupIds?: readonly string[];
  readonly recurrence?: RecurrenceRule | null;
  readonly scheduledAt?: string | null;
}

export function distinctRecipientCount(groupIds: readonly string[]): number {
  const wanted = new Set(groupIds);
  return CONTACTS.filter(
    (contact) =>
      contact.status === 'subscribed' && contact.groupIds.some((id) => wanted.has(id)),
  ).length;
}

/**
 * The audience a campaign will actually reach.
 *
 * Uses the same distinct, opt-out-aware count as `preview-audience` rather than
 * summing the group totals — otherwise the wizard promises 55 recipients and
 * the detail page it lands on says 73, with nothing to explain the jump.
 */
export function audienceSizeFor(groupIds: readonly string[] | undefined): number {
  return distinctRecipientCount(groupIds ?? []);
}

export function findCampaign(id: string): Campaign | undefined {
  return campaignStore.find((entry) => entry.id === id);
}

/** Replaced rather than mutated, so a signal `set()` is not a no-op. */
export function patchCampaign(id: string, patch: Partial<Campaign>): Campaign | undefined {
  const index = campaignStore.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return undefined;
  }
  campaignStore[index] = {
    ...campaignStore[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return campaignStore[index];
}

export function createCampaign(draft: MockCampaignDraft, templateName: string): Campaign {
  const created: Campaign = {
    id: `cmp_${crypto.randomUUID().slice(0, 8)}`,
    name: draft.name,
    templateName,
    status: 'draft',
    metrics: { ...EMPTY_METRICS, audienceSize: audienceSizeFor(draft.groupIds) },
    audienceLabel: draft.audienceLabel,
    scheduledAt: null,
    completedAt: null,
    createdBy: 'You',
    createdAt: new Date().toISOString(),
    description: draft.description ?? '',
    templateId: draft.templateId,
    groupIds: draft.groupIds ?? [],
    recurrence: draft.recurrence ?? null,
    updatedAt: new Date().toISOString(),
  };
  campaignStore.unshift(created);
  return created;
}

export function updateCampaign(
  id: string,
  draft: MockCampaignDraft,
  templateName: string | undefined,
): Campaign | undefined {
  const current = findCampaign(id);
  if (current === undefined) {
    return undefined;
  }
  return patchCampaign(id, {
    name: draft.name,
    description: draft.description ?? '',
    templateId: draft.templateId,
    templateName: templateName ?? current.templateName,
    audienceLabel: draft.audienceLabel,
    groupIds: draft.groupIds ?? [],
    recurrence: draft.recurrence ?? null,
    metrics: { ...current.metrics, audienceSize: audienceSizeFor(draft.groupIds) },
  });
}

/** A copy always starts as a fresh draft with its counters cleared. */
export function duplicateCampaign(id: string): Campaign | undefined {
  const current = findCampaign(id);
  if (current === undefined) {
    return undefined;
  }

  const copy: Campaign = {
    ...current,
    id: `cmp_${crypto.randomUUID().slice(0, 8)}`,
    name: `${current.name} (copy)`,
    status: 'draft',
    metrics: { ...EMPTY_METRICS, audienceSize: current.metrics.audienceSize },
    scheduledAt: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  campaignStore.unshift(copy);
  return copy;
}

export function removeCampaign(id: string): boolean {
  const index = campaignStore.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return false;
  }
  campaignStore.splice(index, 1);
  return true;
}

/**
 * Where a resumed campaign lands.
 *
 * A rule with no occurrences left resumes straight to `completed` rather than
 * back to `scheduled` — there is nothing further to fire. That transition is
 * the one the operator cannot predict from pressing Resume, so the mock has to
 * be able to produce it.
 */
export function resumedStatus(campaign: Campaign): Campaign['status'] {
  const rule = campaign.recurrence;

  if (rule !== undefined && rule !== null && rule.frequency !== 'once') {
    const exhausted =
      rule.endCondition === 'afterCount' &&
      rule.occurrenceCount !== null &&
      (campaign.occurrencesRun ?? 0) >= rule.occurrenceCount;

    return exhausted ? 'completed' : 'scheduled';
  }

  return campaign.scheduledAt === null ? 'draft' : 'scheduled';
}


/* ------------------------------------------------------------------ *
 * Audience preview
 *
 * The real backend deduplicates across groups and honours opt-outs; the mock
 * can do both properly because contacts carry their own group membership. That
 * matters: a mock that just sums the group counts would never disagree with the
 * wizard's estimate, and the whole point of the endpoint is that it does.
 * ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ *
 * Schedules and runs
 * ------------------------------------------------------------------ */

/** How far the named zone is from UTC at a given instant, in milliseconds. */
function zoneOffsetAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  return asIfUtc - utcMs;
}

/**
 * A local date and time in a named zone, as a UTC instant.
 *
 * Worth doing properly even in a stub: building the instant from the browser's
 * zone would have the detail page render "5:00 AM" directly beneath a summary
 * sentence saying 9:00 AM, and a mock that contradicts itself cannot be used to
 * check the thing it exists to check. The second pass handles the DST boundary,
 * where the offset at the guess differs from the offset at the answer.
 */
export function instantInZone(date: string, time: string, timeZone: string): string | null {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = (time || '09:00').split(':').map(Number);
  if ([year, month, day, hours, minutes].some(Number.isNaN)) {
    return null;
  }

  const wallClock = Date.UTC(year, month - 1, day, hours, minutes);
  try {
    const firstPass = wallClock - zoneOffsetAt(wallClock, timeZone);
    return new Date(wallClock - zoneOffsetAt(firstPass, timeZone)).toISOString();
  } catch {
    // An unknown zone falls back to the browser's rather than returning null.
    return new Date(year, month - 1, day, hours, minutes).toISOString();
  }
}

/** The rule's first firing as a UTC instant. */
export function nextRunFor(rule: RecurrenceRule | null | undefined): string | null {
  if (rule === null || rule === undefined) {
    return null;
  }
  const date = firstOccurrenceDate(rule);
  return date === null ? null : instantInZone(date, rule.time, rule.timeZone);
}

/** Runs keyed by campaign, newest first within each list. */
export const runStore = new Map<string, CampaignRun[]>();

let runSequence = 400;

function runMetrics(audienceSize: number, status: CampaignRunStatus) {
  if (status !== 'completed') {
    return { ...EMPTY_METRICS, audienceSize: status === 'skipped' ? 0 : audienceSize };
  }
  const sent = audienceSize;
  const delivered = Math.round(sent * 0.97);
  return {
    audienceSize,
    sent,
    delivered,
    read: Math.round(delivered * 0.74),
    clicked: Math.round(delivered * 0.09),
    failed: sent - delivered,
    skipped: 0,
  };
}

export function listRuns(campaignId: string): readonly CampaignRun[] {
  return runStore.get(campaignId) ?? [];
}

function nextOccurrenceNumber(campaignId: string): number {
  const runs = runStore.get(campaignId) ?? [];
  return runs.reduce((highest, run) => Math.max(highest, run.occurrenceNumber), 0) + 1;
}

export function appendRun(campaignId: string, run: CampaignRun): CampaignRun {
  const runs = runStore.get(campaignId) ?? [];
  runStore.set(campaignId, [run, ...runs]);
  return run;
}

/**
 * A manual run.
 *
 * Deliberately does not touch `nextRunAt` or `occurrencesRun` — Monday is still
 * Monday, and a manual send does not consume an `afterCount` allowance. An
 * already-open run is returned rather than a second one started, so a
 * double-click is harmless.
 */
export function startManualRun(campaign: Campaign): CampaignRun {
  const open = (runStore.get(campaign.id) ?? []).find(
    (run) => run.status === 'pending' || run.status === 'running',
  );
  if (open !== undefined) {
    return open;
  }

  const now = new Date().toISOString();
  return appendRun(campaign.id, {
    id: `run_${(runSequence += 1)}`,
    campaignId: campaign.id,
    occurrenceNumber: nextOccurrenceNumber(campaign.id),
    status: 'running',
    triggeredManually: true,
    scheduledFor: now,
    startedAt: now,
    completedAt: null,
    failureReason: null,
    metrics: { ...EMPTY_METRICS, audienceSize: campaign.metrics.audienceSize },
  });
}

/**
 * Seeds a plausible history for a campaign that has already run.
 *
 * One of them is `skipped` on purpose: the neutral styling and the reason line
 * only get exercised if the data contains one.
 */
function seedRuns(campaign: Campaign, count: number): void {
  const runs: CampaignRun[] = [];
  const audience = campaign.metrics.audienceSize;

  // Anchored on the campaign's own firing time where it has one, so the history
  // agrees with the schedule sentence above it. A paused campaign has no
  // `nextRunAt` but still has a rule, and the rule is what the times must match.
  const scheduledAt = nextRunFor(campaign.recurrence) ?? campaign.nextRunAt ?? null;
  const anchor = scheduledAt === null ? Date.now() : new Date(scheduledAt).getTime();

  for (let index = count; index >= 1; index--) {
    const due = new Date(anchor - index * 7 * 24 * 60 * 60 * 1000);
    const skipped = index === 3;
    const status: CampaignRunStatus = skipped ? 'skipped' : 'completed';

    runs.push({
      id: `run_${(runSequence += 1)}`,
      campaignId: campaign.id,
      occurrenceNumber: count - index + 1,
      status,
      triggeredManually: false,
      scheduledFor: due.toISOString(),
      startedAt: skipped ? null : due.toISOString(),
      completedAt: skipped
        ? null
        : new Date(due.getTime() + 11 * 60 * 1000).toISOString(),
      failureReason: skipped
        ? 'The service was unavailable when this occurrence was due. The most recent missed run was sent and the rest were skipped.'
        : null,
      metrics: runMetrics(audience, status),
    });
  }

  runStore.set(campaign.id, runs.reverse());
}

/**
 * Restates a campaign's lifetime totals as the sum across its runs.
 *
 * Without this the detail page shows "0 sent" directly above a history of
 * completed runs — the totals are defined as the sum, so anything else is the
 * mock contradicting itself.
 */
function rollUp(campaignId: string): void {
  const index = campaignStore.findIndex((entry) => entry.id === campaignId);
  const runs = listRuns(campaignId);
  if (index === -1 || runs.length === 0) {
    return;
  }

  campaignStore[index] = {
    ...campaignStore[index],
    lastRunAt: runs.find((run) => run.status === 'completed')?.scheduledFor ?? null,
    metrics: runs.reduce<CampaignMetrics>(
      (total, run) => ({
        audienceSize: Math.max(total.audienceSize, run.metrics.audienceSize),
        sent: total.sent + run.metrics.sent,
        delivered: total.delivered + run.metrics.delivered,
        read: total.read + run.metrics.read,
        clicked: total.clicked + run.metrics.clicked,
        failed: total.failed + run.metrics.failed,
        skipped: (total.skipped ?? 0) + (run.metrics.skipped ?? 0),
      }),
      { ...EMPTY_METRICS, audienceSize: campaignStore[index].metrics.audienceSize },
    ),
  };
}

/**
 * Makes at least one campaign recurring, and one auto-paused.
 *
 * The seed is otherwise all one-offs, which means the run history, the
 * "All-time totals" label, the Run now button and the pause-reason banner would
 * never be reachable without hand-editing data at runtime.
 */
function enrichSeed(): void {
  const weekly: RecurrenceRule = {
    frequency: 'weekly',
    interval: 1,
    weekdays: [1],
    monthlyMode: 'dayOfMonth',
    dayOfMonth: 1,
    ordinal: 'first',
    ordinalWeekday: 1,
    month: 1,
    startDate: new Date().toISOString().slice(0, 10),
    time: '09:00',
    timeZone: 'Europe/London',
    endCondition: 'never',
    endDate: null,
    occurrenceCount: null,
  };

  const scheduled = campaignStore.findIndex((entry) => entry.status === 'scheduled');
  if (scheduled !== -1) {
    campaignStore[scheduled] = {
      ...campaignStore[scheduled],
      recurrence: weekly,
      timeZone: weekly.timeZone,
      scheduledAt: null,
      completedAt: null,
      nextRunAt: nextRunFor(weekly),
      occurrencesRun: 5,
    };
    seedRuns(campaignStore[scheduled], 5);

    rollUp(campaignStore[scheduled].id);
  }

  // An auto-paused campaign. The explanation lives on the run that could not go
  // out, not on the campaign — so the mock has to record it that way, or the
  // banner would appear here and never in production.
  const paused = campaignStore.findIndex((entry) => entry.status === 'paused');
  if (paused !== -1) {
    // The rule goes on first: `seedRuns` reads it to place the run times, so
    // seeding before assigning it would scatter them across arbitrary clock
    // times that contradict the schedule sentence.
    // Its allowance is already spent, so Resume lands on `completed` rather than
    // back on `scheduled` — the one transition an operator cannot predict, and
    // therefore the one worth being able to reproduce.
    const spent: RecurrenceRule = { ...weekly, endCondition: 'afterCount', occurrenceCount: 3 };
    campaignStore[paused] = {
      ...campaignStore[paused],
      recurrence: spent,
      timeZone: spent.timeZone,
      occurrencesRun: 3,
    };
    const campaign = campaignStore[paused];
    seedRuns(campaign, 3);

    // `scheduledFor` is the instant the occurrence was *due*, not the moment the
    // block was noticed — so it lands on a Monday at 9:00 like every other run.
    const blocked = nextRunFor(weekly) ?? new Date().toISOString();
    appendRun(campaign.id, {
      id: `run_${(runSequence += 1)}`,
      campaignId: campaign.id,
      occurrenceNumber: nextOccurrenceNumber(campaign.id),
      status: 'skipped',
      triggeredManually: false,
      scheduledFor: blocked,
      startedAt: null,
      completedAt: null,
      failureReason: `${campaign.templateName} is paused at Meta and cannot be sent. Fix the template, then resume the campaign.`,
      metrics: { ...EMPTY_METRICS },
    });

    rollUp(campaign.id);
  }

  // A campaign that ends after a fixed number of sends, so the "5 of 12"
  // progress line has something to render.
  const counted = campaignStore.findIndex((entry) => entry.status === 'sending');
  if (counted !== -1) {
    const limited: RecurrenceRule = { ...weekly, endCondition: 'afterCount', occurrenceCount: 12 };
    campaignStore[counted] = {
      ...campaignStore[counted],
      recurrence: limited,
      timeZone: limited.timeZone,
      scheduledAt: null,
      nextRunAt: nextRunFor(limited),
      occurrencesRun: 5,
    };
    seedRuns(campaignStore[counted], 5);
    rollUp(campaignStore[counted].id);
  }
}

/**
 * Every campaign that has actually dispatched gets its runs.
 *
 * A **one-off gets exactly one** — every dispatch opens a run, so the history
 * table is populated for one-offs too, but a single send is a single row.
 * Giving them five would make every one-off read as though it recurred, and the
 * table exists precisely to tell those two things apart.
 */
function seedDispatchedRuns(): void {
  for (const campaign of campaignStore) {
    if (listRuns(campaign.id).length > 0) {
      continue;
    }
    if (!['completed', 'sending', 'failed'].includes(campaign.status)) {
      continue;
    }

    seedRuns(campaign, 1);
    rollUp(campaign.id);
  }
}

// Order matters: the recurring campaigns are made recurring first, so the
// one-off pass below can tell which is which.
enrichSeed();
seedDispatchedRuns();
