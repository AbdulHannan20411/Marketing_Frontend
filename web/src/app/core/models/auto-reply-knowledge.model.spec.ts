import {
  KNOWLEDGE_COLUMNS,
  KNOWLEDGE_TEMPLATE_EXAMPLES,
  KnowledgeFileError,
  knowledgeRow,
  cleanKnowledgeText,
  legacyNotesEntry,
  parseKnowledgeRows,
  splitKeywords,
} from './auto-reply-knowledge.model';

const HEADER = [...KNOWLEDGE_COLUMNS];

describe('auto-reply knowledge rows', () => {
  it('reads each type, with prices and availability only for products', () => {
    const result = parseKnowledgeRows([
      HEADER,
      ['Business info', 'Opening hours', '10am to 9pm', 'Rs 5', 'Yes', ''],
      ['faq', 'Do you deliver?', 'Yes, across Lahore.', '', '', 'delivery; home service, delivery'],
      ['Product or service', 'Facial', '60 minutes', 'Rs 4,000', 'no', 'glow'],
      ['Rule', 'Never promise same-day delivery.', '', '', '', ''],
    ]);

    expect(result.issues).toEqual([]);
    expect(result.entries.map((entry) => entry.kind)).toEqual(['business', 'faq', 'product', 'rule']);
    expect(result.entries[0].price).toBeNull();
    expect(result.entries[0].available).toBeNull();
    expect(result.entries[1].keywords).toEqual(['delivery', 'home service']);
    expect(result.entries[2]).toEqual(
      jasmine.objectContaining({ price: 'Rs 4,000', available: false, keywords: ['glow'] }),
    );
  });

  it('finds the header below notes and skips blank and # rows', () => {
    const result = parseKnowledgeRows([
      ['Glow Studio knowledge'],
      [],
      HEADER,
      ['# Examples below'],
      ['', '', '', '', '', ''],
      ['FAQ', 'Parking?', 'Free, out front.'],
    ]);
    expect(result.entries.length).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('reports bad rows by spreadsheet row number and keeps the rest', () => {
    const result = parseKnowledgeRows([
      HEADER,
      ['FAQ', 'Parking?', 'Free.'],
      ['Offer', 'Eid sale', '20% off'],
      ['FAQ', 'Parking?', 'Again'],
      ['Policy', 'Returns', ''],
      ['Product or service', 'Cut', 'Quick', '', 'maybe'],
      ['', 'No type', 'here'],
    ]);

    expect(result.entries.length).toBe(1);
    expect(result.issues.map((issue) => issue.row)).toEqual([3, 4, 5, 6, 7]);
    expect(result.issues[0].message).toContain('"Offer" is not a type');
    expect(result.issues[1].message).toContain('Repeats row 2');
    expect(result.issues[2].message).toContain('"Answer or details" is empty');
    expect(result.issues[3].message).toContain('Yes or No');
    expect(result.issues[4].message).toContain('"Type" is empty');
  });

  it('refuses a file without the template columns', () => {
    expect(() => parseKnowledgeRows([['Name', 'Phone'], ['Ali', '0300']])).toThrowError(KnowledgeFileError);
  });

  it('warns when the template examples were left in', () => {
    const result = parseKnowledgeRows([HEADER, ...KNOWLEDGE_TEMPLATE_EXAMPLES.map(knowledgeRow)]);
    expect(result.issues).toEqual([]);
    expect(result.entries.length).toBe(KNOWLEDGE_TEMPLATE_EXAMPLES.length);
    expect(result.warnings[0]).toContain("still the template's example");
  });

  it('warns when there is no business info', () => {
    const result = parseKnowledgeRows([HEADER, ['FAQ', 'Refunds?', 'Within 7 days.']]);
    expect(result.warnings).toEqual([jasmine.stringContaining('No business info')]);
  });

  it('round-trips an entry through a template row', () => {
    const [entry] = KNOWLEDGE_TEMPLATE_EXAMPLES.filter((example) => example.kind === 'product');
    const result = parseKnowledgeRows([HEADER, knowledgeRow(entry)]);
    expect(result.entries[0]).toEqual(entry);
  });

  it('splits and de-duplicates keywords', () => {
    expect(splitKeywords(' price; Rate |price,kitna ')).toEqual(['price', 'Rate', 'kitna']);
  });

  it('carries old notes over as one row, and nothing for empty notes', () => {
    expect(legacyNotesEntry('  ')).toBeNull();
    expect(legacyNotesEntry('Open 11-8')?.answer).toBe('Open 11-8');
  });

  it('cleans text the way the API stores it', () => {
    expect(cleanKnowledgeText('<b>Opening</b>\r\nhours\u0007')).toBe('Opening\nhours');
    expect(cleanKnowledgeText('Haircut\nand blow-dry', true)).toBe('Haircut and blow-dry');
    expect(cleanKnowledgeText('Line one\rLine two', true)).toBe('Line one Line two');
  });

  it('makes titles single-line but keeps line breaks in answers', () => {
    const result = parseKnowledgeRows([HEADER, ['FAQ', 'Do you\ndeliver?', 'Yes.\nAcross Lahore.']]);
    expect(result.entries[0].title).toBe('Do you deliver?');
    expect(result.entries[0].answer).toBe('Yes.\nAcross Lahore.');
  });
});
