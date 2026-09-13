import type { EmailTemplateDraft, RenderedEmail } from './email-template.model';
import { EMAIL_SUBJECT_MAX_LENGTH } from './email-template.model';

/**
 * The email template language, and the only place its rules are written.
 *
 * Deliberately tiny, so the server can implement **exactly** the same thing:
 *
 * | Tag | Meaning |
 * | --- | --- |
 * | `{{name}}` | The value, HTML-escaped in the HTML body |
 * | `{{{content}}}` | Raw HTML. Layout only, and only for `content` |
 * | `{{#if name}}…{{else}}…{{/if}}` | Chosen by whether the value is non-blank. Not nestable |
 *
 * A richer language (loops, helpers, partials) would be nicer to author and much
 * harder to keep identical on two platforms. The preview here is only worth
 * trusting if it renders what the server will send.
 */

export const LAYOUT_CONTENT_VARIABLE = 'content';
export const CONTENT_TOKEN = '{{{content}}}';

export type RenderMode = 'html' | 'text';

export type TemplateNode =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'variable'; readonly name: string; readonly raw: boolean }
  | {
      readonly kind: 'condition';
      readonly name: string;
      readonly whenTrue: readonly TemplateNode[];
      readonly whenFalse: readonly TemplateNode[];
    };

export interface ParsedTemplate {
  readonly nodes: readonly TemplateNode[];
  readonly problems: readonly string[];
}

export interface TemplateRules {
  readonly allowedVariables: readonly string[];
  readonly isLayout: boolean;
}

const NAME = '[A-Za-z][A-Za-z0-9_]*';
const TAG = new RegExp(
  `\\{\\{\\{\\s*(${NAME})\\s*\\}\\}\\}|\\{\\{\\s*(?:#if\\s+(${NAME})|(else)|(/if)|(${NAME}))\\s*\\}\\}`,
  'g',
);

/**
 * Matches `System.Net.WebUtility.HtmlEncode` for everything these templates emit.
 *
 * The one difference: WebUtility also encodes characters from U+00A0 to U+00FF
 * as numeric entities (`é` → `&#233;`). Both render identically, so the preview
 * is visually exact even where the bytes differ.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseTemplate(source: string): ParsedTemplate {
  const problems: string[] = [];
  const root: TemplateNode[] = [];

  // Nesting is refused, so one open condition is the most there can be.
  let open: { name: string; whenTrue: TemplateNode[]; whenFalse: TemplateNode[]; inElse: boolean } | null =
    null;

  const target = (): TemplateNode[] =>
    open === null ? root : open.inElse ? open.whenFalse : open.whenTrue;

  const pushText = (value: string): void => {
    if (value === '') {
      return;
    }
    const stray = value.indexOf('{{');
    if (stray !== -1) {
      const near = value.slice(stray, stray + 32).split('\n')[0];
      problems.push(`Unrecognised tag near "${near}".`);
    }
    target().push({ kind: 'text', value });
  };

  let last = 0;
  for (const match of source.matchAll(TAG)) {
    const index = match.index ?? 0;
    pushText(source.slice(last, index));
    last = index + match[0].length;

    const [, rawName, ifName, elseTag, endIf, name] = match;

    if (rawName !== undefined) {
      target().push({ kind: 'variable', name: rawName, raw: true });
    } else if (ifName !== undefined) {
      if (open !== null) {
        problems.push(`Conditions cannot be nested. Close {{#if ${open.name}}} before opening another.`);
      } else {
        open = { name: ifName, whenTrue: [], whenFalse: [], inElse: false };
      }
    } else if (elseTag !== undefined) {
      if (open === null) {
        problems.push('{{else}} appears outside an {{#if}} block.');
      } else if (open.inElse) {
        problems.push(`{{#if ${open.name}}} has more than one {{else}}.`);
      } else {
        open.inElse = true;
      }
    } else if (endIf !== undefined) {
      if (open === null) {
        problems.push('{{/if}} has no matching {{#if}}.');
      } else {
        root.push({ kind: 'condition', name: open.name, whenTrue: open.whenTrue, whenFalse: open.whenFalse });
        open = null;
      }
    } else if (name !== undefined) {
      target().push({ kind: 'variable', name, raw: false });
    }
  }
  pushText(source.slice(last));

  if (open !== null) {
    problems.push(`{{#if ${open.name}}} is never closed with {{/if}}.`);
    root.push({ kind: 'condition', name: open.name, whenTrue: open.whenTrue, whenFalse: open.whenFalse });
  }

  return { nodes: root, problems };
}

function walk(nodes: readonly TemplateNode[], visit: (node: TemplateNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.kind === 'condition') {
      walk(node.whenTrue, visit);
      walk(node.whenFalse, visit);
    }
  }
}

function renderNodes(
  nodes: readonly TemplateNode[],
  values: Readonly<Record<string, string>>,
  mode: RenderMode,
): string {
  let output = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      output += node.value;
    } else if (node.kind === 'variable') {
      const value = values[node.name] ?? '';
      output += mode === 'html' && !node.raw ? escapeHtml(value) : value;
    } else {
      const value = values[node.name] ?? '';
      output += renderNodes(value.trim() !== '' ? node.whenTrue : node.whenFalse, values, mode);
    }
  }
  return output;
}

/** A missing value renders as empty. Validation, not rendering, is where unknown names are caught. */
export function renderTemplate(
  source: string,
  values: Readonly<Record<string, string>>,
  mode: RenderMode,
): string {
  return renderNodes(parseTemplate(source).nodes, values, mode);
}

export function usedVariables(source: string): ReadonlySet<string> {
  const names = new Set<string>();
  walk(parseTemplate(source).nodes, (node) => {
    if (node.kind !== 'text') {
      names.add(node.name);
    }
  });
  return names;
}

/**
 * Renders a body, and wraps it in the layout when one is given.
 *
 * The rendered subject has line breaks flattened: a value carrying `\r\n` would
 * otherwise become a header injection the moment it reached the mail library.
 * Remaining control characters are then stripped, matching the server's
 * `char.IsControl` filter, so a tab in a value previews exactly as it arrives.
 */
export function renderEmail(
  body: EmailTemplateDraft,
  layout: EmailTemplateDraft | null,
  values: Readonly<Record<string, string>>,
): RenderedEmail {
  const subject = renderTemplate(body.subject, values, 'text')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim();
  const html = renderTemplate(body.htmlBody, values, 'html');
  const text = renderTemplate(body.textBody, values, 'text');

  if (layout === null) {
    return { subject, html, text };
  }

  return {
    subject,
    html: renderTemplate(layout.htmlBody, { ...values, subject, [LAYOUT_CONTENT_VARIABLE]: html }, 'html'),
    text: renderTemplate(layout.textBody, { ...values, subject, [LAYOUT_CONTENT_VARIABLE]: text }, 'text'),
  };
}

/** Everything that would stop a draft being saved. Empty means valid. */
export function validateDraft(draft: EmailTemplateDraft, rules: TemplateRules): readonly string[] {
  const problems: string[] = [];

  if (draft.subject.trim() === '') {
    problems.push('The subject cannot be empty.');
  }
  if (/[\r\n]/.test(draft.subject)) {
    problems.push('The subject must be a single line.');
  }
  if (draft.subject.length > EMAIL_SUBJECT_MAX_LENGTH) {
    problems.push(
      `The subject is over ${EMAIL_SUBJECT_MAX_LENGTH} characters. Inboxes cut subjects off long before that.`,
    );
  }
  if (draft.htmlBody.trim() === '') {
    problems.push('The HTML body cannot be empty.');
  }
  if (draft.textBody.trim() === '') {
    problems.push(
      'The plain-text body cannot be empty. Some inboxes show nothing else, and spam filters read it.',
    );
  }
  if (/<script\b/i.test(draft.htmlBody)) {
    problems.push('Remove the <script> tag. Email clients strip scripts, and some treat the message as spam.');
  }

  const allowed = new Set(rules.allowedVariables);
  const unknown = new Set<string>();
  let misusedRaw = false;

  const fields: readonly (readonly [label: string, source: string, isBody: boolean])[] = [
    ['Subject', draft.subject, false],
    ['HTML body', draft.htmlBody, true],
    ['Plain-text body', draft.textBody, true],
  ];

  for (const [label, source, isBody] of fields) {
    const parsed = parseTemplate(source);
    problems.push(...parsed.problems.map((problem) => `${label}: ${problem}`));

    let contentSlots = 0;
    walk(parsed.nodes, (node) => {
      if (node.kind === 'variable' && node.raw) {
        if (rules.isLayout && isBody && node.name === LAYOUT_CONTENT_VARIABLE) {
          contentSlots++;
        } else {
          misusedRaw = true;
        }
        return;
      }
      if (node.kind !== 'text' && !allowed.has(node.name)) {
        unknown.add(node.name);
      }
    });

    if (rules.isLayout && isBody && contentSlots !== 1) {
      problems.push(
        `${label}: the layout must contain ${CONTENT_TOKEN} exactly once. It marks where each email's own content goes.`,
      );
    }
  }

  if (misusedRaw) {
    problems.push(
      `Triple braces insert HTML without escaping, so they are reserved for ${CONTENT_TOKEN} in the layout. Use double braces.`,
    );
  }
  for (const name of unknown) {
    problems.push(`{{${name}}} isn't available in this template.`);
  }

  return problems;
}
