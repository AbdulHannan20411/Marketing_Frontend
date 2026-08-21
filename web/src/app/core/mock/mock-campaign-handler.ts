import type { HttpEvent, HttpParams } from '@angular/common/http';
import type { Observable } from 'rxjs';

import type { MessageTemplate } from '@core/models/whatsapp.model';
import type { RecurrenceRule } from '@core/models/recurrence.model';
import {
  campaignStore,
  createCampaign,
  distinctRecipientCount,
  listRuns,
  nextRunFor,
  startManualRun,
  duplicateCampaign,
  findCampaign,
  patchCampaign,
  removeCampaign,
  resumedStatus,
  updateCampaign,
  type MockCampaignDraft,
} from './mock-campaign-data';

/** The interceptor's own reply helpers, passed in to avoid a circular import. */
export interface MockReplies {
  ok<T>(data: T, message?: string | null): Observable<HttpEvent<unknown>>;
  fail(
    status: number,
    title: string,
    detail: string,
    errorCode?: string,
  ): Observable<HttpEvent<unknown>>;
}

/**
 * Campaign lifecycle for the mock backend.
 *
 * The business rules are enforced here as well as in the UI — pausing a
 * completed campaign, resuming one that is not paused, sending an unapproved
 * template — so those paths can actually be exercised rather than only
 * reasoned about.
 */
export function handleCampaigns(
  path: string,
  method: string,
  body: unknown,
  query: HttpParams,
  templates: readonly MessageTemplate[],
  reply: MockReplies,
): Observable<HttpEvent<unknown>> | null {
  if (!path.startsWith('/campaigns')) {
    return null;
  }

  const nameOf = (templateId: string): string | undefined =>
    templates.find((entry) => entry.id === templateId)?.name;

  if (method === 'POST' && path === '/campaigns') {
    const draft = body as MockCampaignDraft;
    const template = templates.find((entry) => entry.id === draft.templateId);

    if (template !== undefined && template.status !== 'approved') {
      return reply.fail(
        409,
        'Template not approved',
        'Only templates Meta has approved can be sent.',
        'template_not_approved',
      );
    }

    return reply.ok(
      createCampaign(draft, template?.name ?? 'unknown_template'),
      'Campaign created.',
    );
  }

  if (method === 'POST' && path === '/campaigns/preview-audience') {
    const groupIds = (body as { groupIds?: readonly string[] }).groupIds ?? [];
    return reply.ok({ recipientCount: distinctRecipientCount(groupIds) });
  }

  const match = /^\/campaigns\/([^/]+)(\/[a-z-]+)?$/.exec(path);
  if (match === null) {
    return null;
  }

  const [, id, suffix] = match;
  const current = findCampaign(id);
  if (current === undefined) {
    return reply.fail(404, 'Not found', 'That campaign no longer exists.');
  }

  if (method === 'GET' && suffix === undefined) {
    return reply.ok(current);
  }

  if (method === 'PUT' && suffix === undefined) {
    const draft = body as MockCampaignDraft;
    return reply.ok(updateCampaign(id, draft, nameOf(draft.templateId)), 'Campaign updated.');
  }

  if (method === 'DELETE' && suffix === undefined) {
    removeCampaign(id);
    return reply.ok(null, 'Campaign deleted.');
  }

  if (method === 'POST' && suffix === '/duplicate') {
    return reply.ok(duplicateCampaign(id), 'Campaign duplicated.');
  }

  if (method === 'POST' && suffix === '/schedule') {
    const payload = body as { scheduledAt?: string | null; recurrence?: RecurrenceRule | null };
    const rule = payload.recurrence ?? null;
    const isRecurring = rule !== null && rule.frequency !== 'once';

    // The rule wins when there is one: it carries the timezone, and a bare
    // instant does not. A recurring campaign has no single `scheduledAt`.
    const nextRunAt = nextRunFor(rule) ?? payload.scheduledAt ?? null;

    return reply.ok(
      patchCampaign(id, {
        status: 'scheduled',
        scheduledAt: isRecurring ? null : nextRunAt,
        recurrence: rule,
        timeZone: rule?.timeZone,
        nextRunAt,
      }),
      'Campaign scheduled.',
    );
  }

  if (method === 'GET' && suffix === '/runs') {
    const runs = listRuns(id);
    const page = Number(query.get('page') ?? '1');
    const pageSize = Number(query.get('pageSize') ?? '20');
    const start = (page - 1) * pageSize;

    return reply.ok({
      items: runs.slice(start, start + pageSize),
      page,
      pageSize,
      totalItems: runs.length,
      totalPages: Math.max(1, Math.ceil(runs.length / pageSize)),
    });
  }

  if (method === 'POST' && suffix === '/run-now') {
    if (current.status !== 'scheduled') {
      return reply.fail(
        409,
        'Cannot run now',
        'Only a scheduled campaign can be run on demand. Send a draft, or resume a paused campaign first.',
        'campaign_not_scheduled',
      );
    }
    // The schedule is untouched on purpose — the campaign still fires when it
    // was going to, which is the whole point of a manual run.
    return reply.ok(startManualRun(current), 'Run started.');
  }

  if (method === 'POST' && suffix === '/send') {
    return reply.ok(patchCampaign(id, { status: 'sending' }), 'Campaign sending.');
  }

  if (method === 'POST' && suffix === '/pause') {
    if (current.status !== 'sending' && current.status !== 'scheduled') {
      return reply.fail(
        409,
        'Cannot pause',
        'Only a scheduled or sending campaign can be paused.',
        'campaign_not_pausable',
      );
    }
    return reply.ok(patchCampaign(id, { status: 'paused' }), 'Campaign paused.');
  }

  if (method === 'POST' && suffix === '/resume') {
    if (current.status !== 'paused') {
      return reply.fail(
        409,
        'Cannot resume',
        'This campaign is not paused.',
        'campaign_not_paused',
      );
    }
    // Recomputed from now rather than restored: three weeks paused does not
    // mean three sends owed.
    return reply.ok(
      patchCampaign(id, {
        status: resumedStatus(current),
        nextRunAt: nextRunFor(current.recurrence) ?? current.scheduledAt,
      }),
      'Campaign resumed.',
    );
  }

  if (method === 'POST' && suffix === '/cancel') {
    return reply.ok(patchCampaign(id, { status: 'failed' }), 'Campaign cancelled.');
  }

  return null;
}

export { campaignStore };
