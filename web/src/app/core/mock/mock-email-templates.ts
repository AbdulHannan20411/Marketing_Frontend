import type { HttpEvent } from '@angular/common/http';
import type { Observable } from 'rxjs';

import { EMAIL_TEMPLATE_DEFAULTS, type EmailTemplateDefault } from '@core/config/email-template-defaults';
import { validateDraft } from '@core/models/email-template-renderer';
import {
  EMAIL_LAYOUT_KEY,
  type EmailTemplate,
  type EmailTemplateDraft,
  type EmailTemplateSummary,
  variablesFor,
} from '@core/models/email-template.model';

interface MockEmailHelpers {
  readonly ok: (data: unknown, message?: string | null) => Observable<HttpEvent<unknown>>;
  readonly fail: (status: number, title: string, detail: string, errorCode?: string) => Observable<never>;
  readonly failValidation: (errors: Readonly<Record<string, readonly string[]>>) => Observable<never>;
}

/** The signed-in staff member, as far as the handler needs to know. */
export interface MockEmailActor {
  readonly name: string;
  readonly email: string;
  readonly isSuperAdmin: boolean;
}

function seed(template: EmailTemplateDefault): EmailTemplate {
  return { ...template, isCustomised: false, updatedAt: null, updatedBy: null };
}

/** Mutable on purpose: edits survive navigation until the page reloads, as they would in a database. */
const emailTemplateStore: EmailTemplate[] = EMAIL_TEMPLATE_DEFAULTS.map(seed);

function summarise(template: EmailTemplate): EmailTemplateSummary {
  const { htmlBody: _html, textBody: _text, variables: _variables, ...summary } = template;
  return summary;
}

function defaultFor(key: string): EmailTemplateDefault | undefined {
  return EMAIL_TEMPLATE_DEFAULTS.find((template) => template.key === key);
}

function readDraft(body: unknown): EmailTemplateDraft {
  const draft = (body ?? {}) as Partial<EmailTemplateDraft>;
  return {
    subject: typeof draft.subject === 'string' ? draft.subject : '',
    htmlBody: typeof draft.htmlBody === 'string' ? draft.htmlBody : '',
    textBody: typeof draft.textBody === 'string' ? draft.textBody : '',
  };
}

function problemsFor(template: EmailTemplate, draft: EmailTemplateDraft): readonly string[] {
  return validateDraft(draft, {
    allowedVariables: variablesFor(template).map((variable) => variable.name),
    isLayout: template.key === EMAIL_LAYOUT_KEY,
  });
}

/**
 * `/superadmin/email-templates`. Mirrors the API contract in
 * `docs/API-EMAIL-TEMPLATES.md`, including validation with the shared renderer
 * rules — so a draft the editor would let through is still refused here if the
 * client-side check is ever dropped.
 */
export function handleEmailTemplates(
  path: string,
  method: string,
  body: unknown,
  actor: MockEmailActor | null,
  { ok, fail, failValidation }: MockEmailHelpers,
): Observable<HttpEvent<unknown>> | null {
  const match = /^\/superadmin\/email-templates(?:\/([^/]+))?(?:\/(test|reset))?$/.exec(path);
  if (match === null) {
    return null;
  }

  if (actor === null) {
    return fail(401, 'Session expired', 'Please sign in again.');
  }
  if (!actor.isSuperAdmin) {
    return fail(403, 'Not permitted', 'Only platform staff can manage email templates.', 'forbidden');
  }

  const [, rawKey, action] = match;

  if (rawKey === undefined) {
    return method === 'GET' ? ok(emailTemplateStore.map(summarise)) : null;
  }

  const key = decodeURIComponent(rawKey);
  const index = emailTemplateStore.findIndex((template) => template.key === key);
  if (index === -1) {
    return fail(404, 'Template not found', `There is no email template called "${key}".`, 'email_template_not_found');
  }
  const current = emailTemplateStore[index];

  if (action === undefined && method === 'GET') {
    return ok(current);
  }

  if (action === undefined && method === 'PUT') {
    const draft = readDraft(body);
    const problems = problemsFor(current, draft);
    if (problems.length > 0) {
      return failValidation({ Template: problems });
    }
    const shipped = defaultFor(key);
    const updated: EmailTemplate = {
      ...current,
      ...draft,
      isCustomised:
        shipped === undefined ||
        shipped.subject !== draft.subject ||
        shipped.htmlBody !== draft.htmlBody ||
        shipped.textBody !== draft.textBody,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.name,
    };
    emailTemplateStore[index] = updated;
    return ok(updated, 'Template saved.');
  }

  if (action === 'test' && method === 'POST') {
    const problems = problemsFor(current, readDraft(body));
    if (problems.length > 0) {
      return failValidation({ Template: problems });
    }
    return ok({ sentTo: actor.email }, `Test email sent to ${actor.email}.`);
  }

  if (action === 'reset' && method === 'POST') {
    const shipped = defaultFor(key);
    if (shipped === undefined) {
      return fail(409, 'No default', 'This template has no shipped default to return to.', 'email_template_no_default');
    }
    const reset: EmailTemplate = {
      ...seed(shipped),
      updatedAt: new Date().toISOString(),
      updatedBy: actor.name,
    };
    emailTemplateStore[index] = reset;
    return ok(reset, 'Template reset to default.');
  }

  return null;
}
