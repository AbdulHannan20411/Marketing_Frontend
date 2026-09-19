import type { TemplateButtonDraft, TemplateCategory, TemplateHeaderKind } from './whatsapp.model';

/**
 * Meta's review rules for WhatsApp templates, checked while the admin types.
 *
 * A rejection costs a review cycle of minutes to a day, and Meta's reasons are
 * terse. Everything here is either a documented rule (an `error`: Meta will
 * refuse it) or a well-known rejection pattern that is not absolute (a
 * `warning`: likely refused, fix it unless you are sure).
 *
 * WhatsApp text formatting is four markers, not rich text: `*bold*`,
 * `_italic_`, `~strikethrough~` and ```` ```monospace``` ````. The helpers at
 * the bottom wrap a selection in them and render them for the preview.
 */

export type TemplateCheckLevel = 'error' | 'warning';
export type TemplateCheckField = 'name' | 'header' | 'body' | 'examples' | 'footer' | 'buttons' | 'category';

export interface TemplateCheck {
  readonly id: string;
  readonly level: TemplateCheckLevel;
  readonly field: TemplateCheckField;
  readonly message: string;
}

export interface TemplateRuleInput {
  readonly category: TemplateCategory;
  readonly headerKind: TemplateHeaderKind;
  readonly headerText: string;
  readonly bodyText: string;
  readonly bodyExamples: readonly string[];
  readonly headerExample: string;
  readonly footerText: string;
  readonly buttons: readonly TemplateButtonDraft[];
}

export const TEMPLATE_TEXT_LIMITS = {
  header: 60,
  body: 1024,
  footer: 60,
  example: 200,
} as const;

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;
/** Non-global twin for `.test()`, which would otherwise carry `lastIndex` between calls. */
const HAS_PLACEHOLDER = /\{\{\s*\d+\s*\}\}/;
/** Anything brace-like that is not a well-formed `{{n}}`: `{1}`, `{{name}}`, `{{1}`, `{{ }}`. */
const MALFORMED = /\{\{(?!\s*\d+\s*\}\})|(?<!\{)\{(?!\{)[^{}]*\}(?!\})/;
// Pictographs and the joiners/selectors that build them.
const EMOJI = /\p{Extended_Pictographic}/u;
const FORMAT_MARKERS = /[*_~`]/;

/** Words Meta treats as promotional: a utility template containing them is re-categorised. */
const PROMOTIONAL = /\b(sale|discount|offer|% ?off|free|deal|promo(?:tion)?|coupon|limited time|buy now|shop now|cashback)\b/i;

/** Placeholder numbers in order of appearance, duplicates included. */
export function placeholderNumbers(text: string): number[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => Number(match[1]));
}

/** Distinct placeholder numbers, ascending — numerically, so 10 follows 9. */
export function distinctPlaceholders(text: string): number[] {
  return [...new Set(placeholderNumbers(text))].sort((left, right) => left - right);
}

/** Words that are not placeholders, for the words-per-variable rule. */
function wordCount(text: string): number {
  return text
    .replace(PLACEHOLDER, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function unbalancedMarkers(text: string): string[] {
  const withoutPlaceholders = text.replace(PLACEHOLDER, '');
  const problems: string[] = [];
  const mono = (withoutPlaceholders.match(/```/g) ?? []).length;
  if (mono % 2 !== 0) {
    problems.push('```monospace```');
  }
  const rest = withoutPlaceholders.replace(/```/g, '');
  for (const [marker, label] of [
    ['*', '*bold*'],
    ['_', '_italic_'],
    ['~', '~strikethrough~'],
  ] as const) {
    if ((rest.split(marker).length - 1) % 2 !== 0) {
      problems.push(label);
    }
  }
  return problems;
}

export function templateChecks(input: TemplateRuleInput): TemplateCheck[] {
  const checks: TemplateCheck[] = [];
  const add = (id: string, level: TemplateCheckLevel, field: TemplateCheckField, message: string) =>
    checks.push({ id, level, field, message });

  /* ------------------------------ header ------------------------------ */

  if (input.headerKind === 'text') {
    const header = input.headerText;
    const headerVars = distinctPlaceholders(header);
    if (header.trim() === '') {
      add('header-empty', 'error', 'header', 'Add header text, or choose a different header type.');
    }
    if (header.length > TEMPLATE_TEXT_LIMITS.header) {
      add('header-long', 'error', 'header', `The header must be ${TEMPLATE_TEXT_LIMITS.header} characters or fewer.`);
    }
    if (/[\r\n]/.test(header)) {
      add('header-newline', 'error', 'header', 'The header must be one line.');
    }
    if (EMOJI.test(header)) {
      add('header-emoji', 'error', 'header', 'Meta does not allow emoji in the header.');
    }
    if (FORMAT_MARKERS.test(header.replace(PLACEHOLDER, ''))) {
      add('header-format', 'error', 'header', 'Formatting (*, _, ~, `) is not allowed in the header.');
    }
    if (headerVars.length > 1) {
      add('header-vars', 'error', 'header', 'The header can have only one variable, {{1}}.');
    } else if (headerVars.length === 1 && headerVars[0] !== 1) {
      add('header-var-number', 'error', 'header', 'The header variable must be {{1}}.');
    } else if (headerVars.length === 1 && input.headerExample.trim() === '') {
      add('header-example', 'error', 'examples', 'Give an example value for the header variable.');
    }
  }

  /* ------------------------------- body ------------------------------- */

  const body = input.bodyText;
  const trimmed = body.trim();
  const numbers = distinctPlaceholders(body);

  if (trimmed === '') {
    add('body-empty', 'error', 'body', 'The body cannot be empty.');
  } else {
    if (body.length > TEMPLATE_TEXT_LIMITS.body) {
      add('body-long', 'error', 'body', `The body must be ${TEMPLATE_TEXT_LIMITS.body} characters or fewer.`);
    }
    if (/^\{\{\s*\d+\s*\}\}/.test(trimmed)) {
      add('body-starts-var', 'error', 'body', 'The body cannot start with a variable. Put a word before it — "Hi {{1}}".');
    }
    if (/\{\{\s*\d+\s*\}\}$/.test(trimmed)) {
      add('body-ends-var', 'error', 'body', 'The body cannot end with a variable. Add text after it.');
    } else if (/\{\{\s*\d+\s*\}\}[\s.,!?;:]*$/.test(trimmed)) {
      add(
        'body-ends-var-punct',
        'warning',
        'body',
        'Ending on a variable followed only by punctuation is often rejected. Finish with a few words.',
      );
    }
    if (/\}\}\s*\{\{/.test(body)) {
      add('body-adjacent', 'error', 'body', 'Two variables cannot sit side by side. Put words between them.');
    }
    if (MALFORMED.test(body)) {
      add('body-malformed', 'error', 'body', 'Variables must look exactly like {{1}}, {{2}} — numbers in double braces.');
    }
    const gap = numbers.findIndex((number, index) => number !== index + 1);
    if (gap !== -1) {
      add('body-sequence', 'error', 'body', `Variables must run {{1}} to {{${numbers.length}}} with no gaps.`);
    }
    if (numbers.length > 0 && wordCount(body) < numbers.length * 3 + 1) {
      add(
        'body-ratio',
        'warning',
        'body',
        `Too many variables for so few words — Meta usually wants at least ${numbers.length * 3 + 1} words for ${numbers.length}. Add text or remove a variable.`,
      );
    }
    if (/\n{3,}/.test(body)) {
      add('body-blank-lines', 'warning', 'body', 'More than one blank line in a row is often rejected.');
    }
    if (/ {5,}|\t/.test(body)) {
      add('body-spaces', 'warning', 'body', 'Tabs or runs of spaces are often rejected. Use single spaces.');
    }
    const unbalanced = unbalancedMarkers(body);
    if (unbalanced.length > 0) {
      add('body-markers', 'warning', 'body', `Formatting is not closed: ${unbalanced.join(', ')}. It will show as plain symbols.`);
    }
  }

  /* ----------------------------- examples ----------------------------- */

  numbers.forEach((number, index) => {
    const example = input.bodyExamples[index] ?? '';
    if (example.trim() === '') {
      add(`example-${number}`, 'error', 'examples', `Give an example value for {{${number}}} — Meta reviews the message with it filled in.`);
    } else if (/[\r\n\t]| {5,}/.test(example)) {
      add(`example-${number}-format`, 'error', 'examples', `The example for {{${number}}} must be one line without tabs.`);
    } else if (example.length > TEMPLATE_TEXT_LIMITS.example) {
      add(`example-${number}-long`, 'error', 'examples', `The example for {{${number}}} is too long.`);
    }
  });

  /* ------------------------------ footer ------------------------------ */

  const footer = input.footerText;
  if (footer.length > TEMPLATE_TEXT_LIMITS.footer) {
    add('footer-long', 'error', 'footer', `The footer must be ${TEMPLATE_TEXT_LIMITS.footer} characters or fewer.`);
  }
  if (HAS_PLACEHOLDER.test(footer)) {
    add('footer-vars', 'error', 'footer', 'The footer cannot contain variables.');
  }
  if (EMOJI.test(footer) || FORMAT_MARKERS.test(footer)) {
    add('footer-plain', 'warning', 'footer', 'Keep the footer plain — emoji and formatting there are often rejected.');
  }

  /* ------------------------------ buttons ----------------------------- */

  input.buttons.forEach((button, index) => {
    const which = `Button ${index + 1}`;
    if (button.label.trim() === '') {
      add(`button-${index}-label`, 'error', 'buttons', `${which} needs a label.`);
    }
    if (EMOJI.test(button.label)) {
      add(`button-${index}-emoji`, 'warning', 'buttons', `${which}: emoji in button labels are often rejected.`);
    }
    if (button.kind === 'url') {
      const url = button.value.trim();
      if (!/^https:\/\/[^\s]+\.[^\s]+/i.test(url)) {
        add(`button-${index}-url`, 'error', 'buttons', `${which} needs a full https:// link.`);
      } else if (distinctPlaceholders(url).length > 1 || /\{\{\s*\d+\s*\}\}(?!$)/.test(url)) {
        add(`button-${index}-url-var`, 'error', 'buttons', `${which}: a link can have one variable, and only at the very end.`);
      }
    }
    if (button.kind === 'phone_number' && !/^\+[1-9]\d{7,14}$/.test(button.value.replace(/[\s-]/g, ''))) {
      add(`button-${index}-phone`, 'error', 'buttons', `${which} needs a number in international format, e.g. +923001234567.`);
    }
  });

  /* ------------------------------ category ---------------------------- */

  if (input.category === 'utility' && PROMOTIONAL.test(`${input.headerText} ${body} ${footer}`)) {
    add(
      'category-promotional',
      'warning',
      'category',
      'This reads as promotional. Meta will likely move it to Marketing, which is charged at a higher rate.',
    );
  }
  if (input.category === 'marketing' && footer.trim() === '') {
    add('marketing-optout', 'warning', 'footer', 'Marketing templates should tell people how to opt out, e.g. "Reply STOP to unsubscribe".');
  }

  return checks;
}

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

export type WhatsAppFormat = 'bold' | 'italic' | 'strike' | 'mono';

export const WHATSAPP_FORMAT_MARKERS: Readonly<Record<WhatsAppFormat, string>> = {
  bold: '*',
  italic: '_',
  strike: '~',
  mono: '```',
};

export interface TextEdit {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/**
 * Wraps the selection in a format's markers — or unwraps it when it is already
 * wrapped, so the button toggles. With nothing selected it inserts an empty
 * pair and leaves the cursor between them.
 *
 * Surrounding spaces are kept outside the markers: WhatsApp ignores `* bold*`.
 */
export function toggleFormat(text: string, start: number, end: number, format: WhatsAppFormat): TextEdit {
  const marker = WHATSAPP_FORMAT_MARKERS[format];
  const m = marker.length;

  // Already wrapped (markers just outside the selection): unwrap.
  if (start >= m && text.slice(start - m, start) === marker && text.slice(end, end + m) === marker) {
    return {
      text: text.slice(0, start - m) + text.slice(start, end) + text.slice(end + m),
      selectionStart: start - m,
      selectionEnd: end - m,
    };
  }

  const selected = text.slice(start, end);
  const leading = selected.length - selected.trimStart().length;
  const trailing = selected.length - selected.trimEnd().length;
  const innerStart = start + leading;
  const innerEnd = Math.max(innerStart, end - trailing);
  const inner = text.slice(innerStart, innerEnd);

  return {
    text: text.slice(0, innerStart) + marker + inner + marker + text.slice(innerEnd),
    selectionStart: innerStart + m,
    selectionEnd: innerEnd + m,
  };
}

/** Inserts text at the cursor (replacing any selection) and puts the cursor after it. */
export function insertAt(text: string, start: number, end: number, insertion: string): TextEdit {
  const next = text.slice(0, start) + insertion + text.slice(end);
  const cursor = start + insertion.length;
  return { text: next, selectionStart: cursor, selectionEnd: cursor };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The message as WhatsApp shows it: markers become formatting, variables
 * become their examples. Escaped first, so nothing typed can become markup.
 */
export function renderWhatsAppPreview(text: string, examples: readonly string[] = []): string {
  const filled = text.replace(PLACEHOLDER, (_, number: string) => {
    const example = examples[Number(number) - 1]?.trim();
    return example ? example : `{{${number}}}`;
  });

  return escapeHtml(filled)
    .replace(/```([\s\S]+?)```/g, '<code class="font-mono text-[0.8125rem]">$1</code>')
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)(?<!\s)\*(?=$|[\s).,!?:;])/g, '$1<strong>$2</strong>')
    .replace(/(^|[\s(])_(?!\s)([^_\n]+?)(?<!\s)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])~(?!\s)([^~\n]+?)(?<!\s)~(?=$|[\s).,!?:;])/g, '$1<s>$2</s>')
    .replace(/\n/g, '<br>');
}

/** A handful of emoji that suit business messages, for the toolbar picker. */
export const TEMPLATE_EMOJI: readonly string[] = [
  '😊', '👋', '🙏', '🎉', '✅', '⭐', '🔥', '💯',
  '🎁', '🛍️', '🛒', '📦', '🚚', '⏰', '📅', '📍',
  '💳', '💰', '📞', '💬', '❤️', '👍', '⚡', '📢',
];
