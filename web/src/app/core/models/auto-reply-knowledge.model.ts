/**
 * What the auto-reply assistant knows about the business.
 *
 * Instead of one free-text box, the admin fills in a spreadsheet template —
 * business details, FAQs, products and services, policies and rules — and
 * uploads it. Structured rows let the assistant quote exact answers, prices and
 * hours, and tell when a question is simply not covered, which a paragraph of
 * notes cannot do.
 *
 * The file is read in the browser only to preview and check it; what is saved
 * is the list of entries below, which the API validates again.
 */

export const KNOWLEDGE_KINDS = ['business', 'faq', 'product', 'policy', 'rule'] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export interface KnowledgeEntry {
  readonly kind: KnowledgeKind;
  /** The question, product name, policy name or the rule itself. */
  readonly title: string;
  /** The answer or details. Optional for a rule, required otherwise. */
  readonly answer: string;
  /** Products and services only, as written — "Rs 2,500", "From Rs 35,000". */
  readonly price: string | null;
  /** Products and services only; `null` when not stated. */
  readonly available: boolean | null;
  /** Other ways customers ask, to help match their wording. */
  readonly keywords: readonly string[];
}

/** What happens when a customer asks something the entries do not answer. */
export type KnowledgeFallback = 'handoff' | 'silent';

export interface AutoReplyKnowledge {
  readonly entries: readonly KnowledgeEntry[];
  readonly fallback: KnowledgeFallback;
  /** Sent when `fallback` is `handoff`. */
  readonly fallbackMessage: string;
  readonly sourceFileName: string | null;
  readonly updatedAt: string | null;
  readonly updatedByName: string | null;
}

/** Saving replaces every entry at once — the uploaded file is the whole truth. */
export interface AutoReplyKnowledgeDraft {
  readonly entries: readonly KnowledgeEntry[];
  readonly fallback: KnowledgeFallback;
  readonly fallbackMessage: string;
  readonly sourceFileName: string | null;
}

/** Mirrors the API, so a file it would refuse is caught before it is sent. */
export const KNOWLEDGE_LIMITS = {
  maxEntries: 500,
  titleMax: 200,
  answerMax: 1000,
  priceMax: 60,
  maxKeywords: 10,
  keywordMax: 60,
  fallbackMessageMax: 300,
  fileBytes: 2 * 1024 * 1024,
} as const;

export const DEFAULT_FALLBACK_MESSAGE =
  'Thanks for your message! Someone from our team will get back to you shortly.';

export const KNOWLEDGE_FALLBACK_OPTIONS: readonly {
  readonly value: KnowledgeFallback;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: 'handoff',
    label: 'Send a holding message',
    hint: 'The customer hears back straight away, and the conversation waits for your team.',
  },
  {
    value: 'silent',
    label: 'Say nothing',
    hint: 'No automatic reply at all — your team answers it.',
  },
];

export interface KnowledgeKindCopy {
  /** What the dropdown in the template offers. */
  readonly option: string;
  /** Plural, for counts on screen. */
  readonly plural: string;
  readonly titleHint: string;
  readonly answerHint: string;
}

export const KNOWLEDGE_KIND_COPY: Readonly<Record<KnowledgeKind, KnowledgeKindCopy>> = {
  business: {
    option: 'Business info',
    plural: 'Business info',
    titleHint: 'What it is: Business name, Opening hours, Address, Phone, Website, Delivery areas',
    answerHint: 'The detail itself',
  },
  faq: {
    option: 'FAQ',
    plural: 'FAQs',
    titleHint: 'The question as a customer would ask it',
    answerHint: 'The answer to send',
  },
  product: {
    option: 'Product or service',
    plural: 'Products and services',
    titleHint: 'Its name',
    answerHint: 'What it is, what is included, how long it takes',
  },
  policy: {
    option: 'Policy',
    plural: 'Policies',
    titleHint: 'Its name: Returns, Delivery, Payment, Cancellations',
    answerHint: 'The policy in full',
  },
  rule: {
    option: 'Rule',
    plural: 'Rules',
    titleHint: 'Something the assistant must always or never do',
    answerHint: 'Optional — more detail',
  },
};

/** Column order in the template. The header text is what the reader looks for. */
export const KNOWLEDGE_COLUMNS = [
  'Type',
  'Question or name',
  'Answer or details',
  'Price',
  'Available',
  'Other ways customers ask',
] as const;

export const AVAILABLE_OPTIONS = ['Yes', 'No'] as const;

export const KNOWLEDGE_SHEET_NAME = 'Knowledge';

/** Accepted when reading a file, so a renamed or older header still lines up. */
const HEADER_ALIASES: Readonly<Record<keyof KnowledgeColumnMap, readonly string[]>> = {
  type: ['type', 'kind', 'category'],
  title: ['question or name', 'question', 'name', 'title', 'topic', 'rule'],
  answer: ['answer or details', 'answer', 'details', 'description', 'reply'],
  price: ['price', 'cost', 'rate'],
  available: ['available', 'availability', 'in stock'],
  keywords: ['other ways customers ask', 'keywords', 'keyword', 'also asked as', 'synonyms'],
};

interface KnowledgeColumnMap {
  readonly type: number;
  readonly title: number;
  readonly answer: number;
  readonly price: number;
  readonly available: number;
  readonly keywords: number;
}

const KIND_ALIASES: Readonly<Record<string, KnowledgeKind>> = {
  'business info': 'business',
  business: 'business',
  about: 'business',
  info: 'business',
  faq: 'faq',
  faqs: 'faq',
  question: 'faq',
  'q&a': 'faq',
  'product or service': 'product',
  'product / service': 'product',
  product: 'product',
  service: 'product',
  products: 'product',
  services: 'product',
  policy: 'policy',
  policies: 'policy',
  rule: 'rule',
  rules: 'rule',
  instruction: 'rule',
};

const YES = new Set(['yes', 'y', 'true', '1', 'available', 'in stock']);
const NO = new Set(['no', 'n', 'false', '0', 'unavailable', 'out of stock', 'sold out']);

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function kindFrom(value: string): KnowledgeKind | null {
  return KIND_ALIASES[normalise(value)] ?? null;
}

/**
 * The API's clean-up, mirrored: markup tags and control characters (except
 * line breaks) are removed. `singleLine` also folds line breaks into spaces,
 * which the API does for titles, prices and keywords.
 */
export function cleanKnowledgeText(value: string, singleLine = false): string {
  const cleaned = value
    // Line endings first, or a lone \r would be dropped as a control character.
    .replace(/\r\n?/g, '\n')
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, (char) => (char === '\t' ? ' ' : ''));
  return (singleLine ? cleaned.replace(/\s*\n\s*/g, ' ') : cleaned).trim();
}

export function splitKeywords(value: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const part of value.split(/[;,|\n]/)) {
    const keyword = part.trim();
    if (keyword !== '' && !seen.has(keyword.toLowerCase())) {
      seen.add(keyword.toLowerCase());
      keywords.push(keyword);
    }
  }
  return keywords;
}

/** One entry's problems, worded for the admin. Shared by the file check and the mock API. */
export function knowledgeEntryProblems(entry: KnowledgeEntry): string[] {
  const limits = KNOWLEDGE_LIMITS;
  const problems: string[] = [];
  const copy = KNOWLEDGE_KIND_COPY[entry.kind];

  if (entry.title.trim() === '') {
    problems.push(`"Question or name" is empty.`);
  } else if (entry.title.length > limits.titleMax) {
    problems.push(`"Question or name" is over ${limits.titleMax} characters.`);
  }
  if (entry.kind !== 'rule' && entry.answer.trim() === '') {
    problems.push(`"Answer or details" is empty — a ${copy.option.toLowerCase()} needs one.`);
  }
  if (entry.answer.length > limits.answerMax) {
    problems.push(`"Answer or details" is over ${limits.answerMax} characters — split it into two rows.`);
  }
  if (entry.price !== null && entry.price.length > limits.priceMax) {
    problems.push(`"Price" is over ${limits.priceMax} characters.`);
  }
  if (entry.keywords.length > limits.maxKeywords) {
    problems.push(`At most ${limits.maxKeywords} "Other ways customers ask".`);
  }
  if (entry.keywords.some((keyword) => keyword.length > limits.keywordMax)) {
    problems.push(`Each "Other ways customers ask" must be under ${limits.keywordMax} characters.`);
  }
  return problems;
}

export interface KnowledgeRowIssue {
  /** The spreadsheet row, as the admin sees it in Excel. */
  readonly row: number;
  readonly message: string;
}

export interface KnowledgeImport {
  readonly entries: readonly KnowledgeEntry[];
  /** Rows left out. The rest can still be saved. */
  readonly issues: readonly KnowledgeRowIssue[];
  /** Worth knowing, but nothing was left out for them. */
  readonly warnings: readonly string[];
}

export class KnowledgeFileError extends Error {}

function findColumns(header: readonly string[]): KnowledgeColumnMap | null {
  const normalised = header.map(normalise);
  const find = (key: keyof KnowledgeColumnMap) =>
    normalised.findIndex((cell) => HEADER_ALIASES[key].includes(cell));
  const map: KnowledgeColumnMap = {
    type: find('type'),
    title: find('title'),
    answer: find('answer'),
    price: find('price'),
    available: find('available'),
    keywords: find('keywords'),
  };
  return map.type >= 0 && map.title >= 0 && map.answer >= 0 ? map : null;
}

/**
 * Turns the rows of an uploaded sheet into entries.
 *
 * The header row is found rather than assumed, so notes above it do no harm.
 * Blank rows and rows whose Type starts with `#` are skipped. A bad row is
 * reported with its spreadsheet row number and left out; the rest still count.
 *
 * @throws KnowledgeFileError when the file is not the template at all.
 */
export function parseKnowledgeRows(rows: readonly (readonly string[])[]): KnowledgeImport {
  let headerIndex = -1;
  let columns: KnowledgeColumnMap | null = null;
  for (let i = 0; i < Math.min(rows.length, 20) && columns === null; i++) {
    columns = findColumns(rows[i] ?? []);
    headerIndex = i;
  }
  if (columns === null) {
    throw new KnowledgeFileError(
      'This file is not the template — it needs "Type", "Question or name" and "Answer or details" columns. Download the template and fill that in.',
    );
  }

  const cell = (row: readonly string[], index: number, singleLine = true) =>
    index >= 0 ? cleanKnowledgeText(row[index] ?? '', singleLine) : '';
  const entries: KnowledgeEntry[] = [];
  const issues: KnowledgeRowIssue[] = [];
  const firstRowFor = new Map<string, number>();
  const kindOptions = KNOWLEDGE_KINDS.map((kind) => KNOWLEDGE_KIND_COPY[kind].option).join(', ');

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const raw = rows[i] ?? [];
    const rowNumber = i + 1;
    const typeText = cell(raw, columns.type);
    if (raw.every((value) => value.trim() === '') || typeText.startsWith('#')) {
      continue;
    }

    const kind = kindFrom(typeText);
    if (kind === null) {
      issues.push({
        row: rowNumber,
        message:
          typeText === ''
            ? `"Type" is empty. Choose one of: ${kindOptions}.`
            : `"${typeText}" is not a type. Choose one of: ${kindOptions}.`,
      });
      continue;
    }

    const availableText = normalise(cell(raw, columns.available));
    let available: boolean | null = null;
    if (kind === 'product' && availableText !== '') {
      if (YES.has(availableText)) {
        available = true;
      } else if (NO.has(availableText)) {
        available = false;
      } else {
        issues.push({ row: rowNumber, message: `"Available" must be Yes or No, not "${cell(raw, columns.available)}".` });
        continue;
      }
    }

    const price = kind === 'product' ? cell(raw, columns.price) : '';
    const entry: KnowledgeEntry = {
      kind,
      title: cell(raw, columns.title),
      answer: cell(raw, columns.answer, false),
      price: price === '' ? null : price,
      available,
      keywords: splitKeywords(cell(raw, columns.keywords, false)),
    };

    const problems = knowledgeEntryProblems(entry);
    if (problems.length > 0) {
      issues.push({ row: rowNumber, message: problems.join(' ') });
      continue;
    }

    const key = `${kind}|${normalise(entry.title)}`;
    const earlier = firstRowFor.get(key);
    if (earlier !== undefined) {
      issues.push({ row: rowNumber, message: `Repeats row ${earlier} ("${entry.title}"). Keep one of them.` });
      continue;
    }
    firstRowFor.set(key, rowNumber);

    if (entries.length >= KNOWLEDGE_LIMITS.maxEntries) {
      issues.push({ row: rowNumber, message: `Only ${KNOWLEDGE_LIMITS.maxEntries} entries fit — this row and any after it were left out.` });
      break;
    }
    entries.push(entry);
  }

  return { entries, issues, warnings: knowledgeWarnings(entries) };
}

function knowledgeWarnings(entries: readonly KnowledgeEntry[]): string[] {
  const warnings: string[] = [];
  const exampleTitles = new Set(KNOWLEDGE_TEMPLATE_EXAMPLES.map((entry) => normalise(entry.title)));
  const examples = entries.filter((entry) => exampleTitles.has(normalise(entry.title))).length;

  if (examples > 0) {
    warnings.push(
      `${examples} ${examples === 1 ? 'row is' : 'rows are'} still the template's example. Replace ${examples === 1 ? 'it' : 'them'} with your own details, or the assistant will repeat them to customers.`,
    );
  }
  if (entries.length > 0 && !entries.some((entry) => entry.kind === 'business')) {
    warnings.push('No business info. Add at least your business name and opening hours — customers ask these most.');
  }
  return warnings;
}

export function countByKind(entries: readonly KnowledgeEntry[]): Readonly<Record<KnowledgeKind, number>> {
  const counts: Record<KnowledgeKind, number> = { business: 0, faq: 0, product: 0, policy: 0, rule: 0 };
  for (const entry of entries) {
    counts[entry.kind]++;
  }
  return counts;
}

/** An entry as a template row, in `KNOWLEDGE_COLUMNS` order. */
export function knowledgeRow(entry: KnowledgeEntry): string[] {
  return [
    KNOWLEDGE_KIND_COPY[entry.kind].option,
    entry.title,
    entry.answer,
    entry.price ?? '',
    entry.available === null ? '' : entry.available ? 'Yes' : 'No',
    entry.keywords.join('; '),
  ];
}

/**
 * Notes typed into the old free-text box, carried into the spreadsheet so
 * nothing is lost when the admin moves to the template.
 */
export function legacyNotesEntry(notes: string): KnowledgeEntry | null {
  const text = notes.trim();
  return text === ''
    ? null
    : { kind: 'business', title: 'Notes', answer: text, price: null, available: null, keywords: [] };
}

/** How-to rows for the template's second sheet. */
export const KNOWLEDGE_GUIDE_ROWS: readonly (readonly string[])[] = [
  ['Type', 'Question or name', 'Answer or details', 'Price and Available'],
  ...KNOWLEDGE_KINDS.map((kind) => [
    KNOWLEDGE_KIND_COPY[kind].option,
    KNOWLEDGE_KIND_COPY[kind].titleHint,
    KNOWLEDGE_KIND_COPY[kind].answerHint,
    kind === 'product' ? 'Price as you would write it ("Rs 2,500"). Available: Yes or No.' : 'Leave empty',
  ]),
  ['', '', '', ''],
  ['Tips', 'One fact per row. Short rows are answered more accurately than long ones.', '', ''],
  ['', 'Replace the example rows on the Knowledge sheet with your own.', '', ''],
  ['', '"Other ways customers ask": words separated by ; — for example: price; rate; kitna', '', ''],
  ['', 'The assistant only answers from these rows. Anything else goes to your team.', '', ''],
  ['', 'Save as .xlsx (or .csv) and upload it on the Auto-reply page.', '', ''],
];

/** Example rows in the downloaded template — a salon, so they read as real. */
export const KNOWLEDGE_TEMPLATE_EXAMPLES: readonly KnowledgeEntry[] = [
  { kind: 'business', title: 'Business name', answer: 'Glow Studio — a hair and beauty salon for women.', price: null, available: null, keywords: [] },
  { kind: 'business', title: 'Opening hours', answer: 'Monday to Saturday, 11am to 8pm. Closed on Sunday.', price: null, available: null, keywords: ['timings', 'open', 'close'] },
  { kind: 'business', title: 'Address', answer: '24-C Main Boulevard, Gulberg III, Lahore.', price: null, available: null, keywords: ['location', 'where'] },
  { kind: 'faq', title: 'Do I need an appointment?', answer: 'Walk-ins are welcome, but booking ahead guarantees your slot.', price: null, available: null, keywords: ['booking', 'walk in'] },
  { kind: 'faq', title: 'Is there parking?', answer: 'Yes, free parking in front of the salon.', price: null, available: null, keywords: [] },
  { kind: 'product', title: 'Haircut and blow-dry', answer: 'Wash, cut and blow-dry. Takes about 45 minutes.', price: 'Rs 2,500', available: true, keywords: ['haircut', 'trim'] },
  { kind: 'product', title: 'Bridal makeup', answer: 'Full bridal makeup including a trial. Book at least 2 weeks ahead.', price: 'From Rs 35,000', available: true, keywords: ['bridal', 'wedding'] },
  { kind: 'policy', title: 'Cancellations', answer: 'Cancel at least 3 hours before your appointment. Late cancellations may be charged 20%.', price: null, available: null, keywords: [] },
  { kind: 'policy', title: 'Payment', answer: 'Cash, card and JazzCash accepted.', price: null, available: null, keywords: ['pay'] },
  { kind: 'rule', title: 'Never offer discounts or prices that are not listed here.', answer: '', price: null, available: null, keywords: [] },
  { kind: 'rule', title: 'For complaints, apologise and say a team member will call back today.', answer: '', price: null, available: null, keywords: [] },
];
