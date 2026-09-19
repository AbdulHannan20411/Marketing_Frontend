import {
  distinctPlaceholders,
  insertAt,
  renderWhatsAppPreview,
  templateChecks,
  toggleFormat,
  type TemplateRuleInput,
} from './template-rules.model';
import { templateVariables } from './whatsapp.model';

function input(overrides: Partial<TemplateRuleInput> = {}): TemplateRuleInput {
  return {
    category: 'utility',
    headerKind: 'none',
    headerText: '',
    bodyText: 'Hi {{1}}, your order {{2}} has shipped and will arrive by tomorrow evening.',
    bodyExamples: ['Ayesha', 'ORD-1042'],
    headerExample: '',
    footerText: '',
    buttons: [],
    ...overrides,
  };
}

const ids = (overrides: Partial<TemplateRuleInput> = {}) => templateChecks(input(overrides)).map((check) => check.id);

describe('template rules', () => {
  it('passes a well-formed utility template', () => {
    expect(templateChecks(input())).toEqual([]);
  });

  it('refuses a body that starts or ends with a variable', () => {
    expect(ids({ bodyText: '{{1}}, your order is ready for pickup at the counter.' })).toContain('body-starts-var');
    expect(ids({ bodyText: 'Your order is ready for pickup, {{1}}', bodyExamples: ['Ayesha'] })).toContain('body-ends-var');
    expect(ids({ bodyText: 'Your order is ready for pickup, {{1}}.', bodyExamples: ['Ayesha'] })).toContain('body-ends-var-punct');
  });

  it('refuses adjacent, out-of-sequence and malformed variables', () => {
    expect(ids({ bodyText: 'Hello {{1}} {{2}} and welcome back to our store today.' })).toContain('body-adjacent');
    expect(ids({ bodyText: 'Hi {{1}}, your code {{3}} is ready to use at checkout today.' })).toContain('body-sequence');
    expect(ids({ bodyText: 'Hi {{name}}, your order has shipped and arrives tomorrow.', bodyExamples: [] })).toContain('body-malformed');
    expect(ids({ bodyText: 'Hi {1}, your order has shipped and arrives tomorrow.', bodyExamples: [] })).toContain('body-malformed');
  });

  it('warns when there are too many variables for the words', () => {
    expect(ids({ bodyText: 'Hi {{1}} got {{2}} ok.' })).toContain('body-ratio');
  });

  it('asks for an example for every variable', () => {
    expect(ids({ bodyExamples: ['Ayesha'] })).toContain('example-2');
    expect(ids({ bodyExamples: ['Ayesha', 'line one\nline two'] })).toContain('example-2-format');
  });

  it('keeps headers and footers plain', () => {
    expect(ids({ headerKind: 'text', headerText: 'Order *update* 🎉' })).toEqual(
      jasmine.arrayContaining(['header-emoji', 'header-format']),
    );
    expect(ids({ headerKind: 'text', headerText: 'For {{1}} and {{2}}' })).toContain('header-vars');
    expect(ids({ headerKind: 'text', headerText: 'For {{1}}' })).toContain('header-example');
    expect(ids({ footerText: 'Thanks {{1}}' })).toContain('footer-vars');
  });

  it('checks button links and numbers', () => {
    expect(ids({ buttons: [{ kind: 'url', label: 'Track', value: 'example.com' }] })).toContain('button-0-url');
    expect(ids({ buttons: [{ kind: 'url', label: 'Track', value: 'https://x.com/{{1}}/track' }] })).toContain('button-0-url-var');
    expect(ids({ buttons: [{ kind: 'url', label: 'Track', value: 'https://x.com/track/{{1}}' }] })).toEqual([]);
    expect(ids({ buttons: [{ kind: 'phone_number', label: 'Call', value: '0300 1234567' }] })).toContain('button-0-phone');
  });

  it('flags promotional wording in a utility template, and a missing opt-out on marketing', () => {
    expect(ids({ bodyText: 'Hi {{1}}, get 20% off with this discount on order {{2}} today only.' })).toContain(
      'category-promotional',
    );
    expect(ids({ category: 'marketing' })).toContain('marketing-optout');
  });

  it('orders variables numerically', () => {
    const body = Array.from({ length: 11 }, (_, i) => `word word word {{${i + 1}}}`).join(' ') + ' end';
    expect(distinctPlaceholders(body).at(-1)).toBe(11);
    expect(templateVariables(body).slice(-2)).toEqual(['{{10}}', '{{11}}']);
  });
});

describe('WhatsApp formatting helpers', () => {
  it('wraps a selection, keeping surrounding spaces outside the markers', () => {
    const edit = toggleFormat('Hello big world', 5, 10, 'bold');
    expect(edit.text).toBe('Hello *big* world');
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe('big');
  });

  it('unwraps when pressed again', () => {
    const wrapped = toggleFormat('Hello big world', 6, 9, 'italic');
    const unwrapped = toggleFormat(wrapped.text, wrapped.selectionStart, wrapped.selectionEnd, 'italic');
    expect(unwrapped.text).toBe('Hello big world');
  });

  it('inserts an empty pair at the cursor, with the cursor inside', () => {
    const edit = toggleFormat('Hi ', 3, 3, 'mono');
    expect(edit.text).toBe('Hi ``````');
    expect(edit.selectionStart).toBe(6);
  });

  it('inserts at the cursor', () => {
    expect(insertAt('Hi there', 2, 2, ' 👋').text).toBe('Hi 👋 there');
  });

  it('renders formatting and examples, and escapes everything typed', () => {
    const html = renderWhatsAppPreview('Hi {{1}}, *big* _sale_ ~old~ <b>x</b>\nBye', ['Ayesha']);
    expect(html).toContain('Hi Ayesha,');
    expect(html).toContain('<strong>big</strong>');
    expect(html).toContain('<em>sale</em>');
    expect(html).toContain('<s>old</s>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('<br>');
  });
});
