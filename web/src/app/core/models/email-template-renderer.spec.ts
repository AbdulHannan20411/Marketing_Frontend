import {
  escapeHtml,
  parseTemplate,
  renderEmail,
  renderTemplate,
  usedVariables,
  validateDraft,
} from './email-template-renderer';

const BODY_RULES = { allowedVariables: ['name', 'inviterName', 'appName'], isLayout: false };
const LAYOUT_RULES = { allowedVariables: ['appName', 'subject'], isLayout: true };

describe('email template renderer', () => {
  describe('escapeHtml', () => {
    it('encodes the characters WebUtility.HtmlEncode encodes', () => {
      expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
        '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
      );
    });
  });

  describe('renderTemplate', () => {
    it('escapes double-brace values in HTML but not in plain text', () => {
      const values = { name: '<b>Ayesha</b>' };
      expect(renderTemplate('Hi {{name}}', values, 'html')).toBe('Hi &lt;b&gt;Ayesha&lt;/b&gt;');
      expect(renderTemplate('Hi {{name}}', values, 'text')).toBe('Hi <b>Ayesha</b>');
    });

    it('tolerates whitespace inside tags', () => {
      expect(renderTemplate('{{ name }}', { name: 'A' }, 'text')).toBe('A');
    });

    it('renders a missing value as empty', () => {
      expect(renderTemplate('[{{name}}]', {}, 'html')).toBe('[]');
    });

    it('chooses the branch by whether the value is non-blank', () => {
      const source = '{{#if inviterName}}{{inviterName}} invited you{{else}}You were invited{{/if}}';
      expect(renderTemplate(source, { inviterName: 'Amara' }, 'text')).toBe('Amara invited you');
      expect(renderTemplate(source, { inviterName: '   ' }, 'text')).toBe('You were invited');
      expect(renderTemplate(source, {}, 'text')).toBe('You were invited');
    });

    it('inserts triple-brace values raw', () => {
      expect(renderTemplate('<td>{{{content}}}</td>', { content: '<p>x</p>' }, 'html')).toBe('<td><p>x</p></td>');
    });
  });

  describe('parseTemplate', () => {
    it('refuses nested conditions', () => {
      const { problems } = parseTemplate('{{#if a}}{{#if b}}x{{/if}}{{/if}}');
      expect(problems.some((problem) => problem.includes('cannot be nested'))).toBeTrue();
    });

    it('reports an unclosed condition', () => {
      expect(parseTemplate('{{#if a}}x').problems).toEqual(['{{#if a}} is never closed with {{/if}}.']);
    });

    it('reports stray else and end tags', () => {
      const { problems } = parseTemplate('{{else}}{{/if}}');
      expect(problems.length).toBe(2);
    });

    it('reports tags it does not recognise', () => {
      expect(parseTemplate('Hello {{user.name}}').problems[0]).toContain('Unrecognised tag');
    });
  });

  it('lists every variable used, including inside conditions', () => {
    expect([...usedVariables('{{a}} {{#if b}}{{c}}{{else}}{{d}}{{/if}}')].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  describe('renderEmail', () => {
    const layout = { subject: '{{subject}}', htmlBody: '<title>{{subject}}</title><main>{{{content}}}</main>', textBody: '== {{{content}}} ==' };

    it('wraps the body in the layout and passes the rendered subject to it', () => {
      const email = renderEmail(
        { subject: 'Hi {{name}}', htmlBody: '<p>{{name}}</p>', textBody: '{{name}}' },
        layout,
        { name: 'A&B' },
      );
      expect(email.subject).toBe('Hi A&B');
      expect(email.html).toBe('<title>Hi A&amp;B</title><main><p>A&amp;B</p></main>');
      expect(email.text).toBe('== A&B ==');
    });

    it('flattens line breaks in the subject so a value cannot inject headers', () => {
      const email = renderEmail({ subject: 'Hi {{name}}', htmlBody: 'x', textBody: 'x' }, null, {
        name: 'A\r\nBcc: victim@example.com',
      });
      expect(email.subject).toBe('Hi A Bcc: victim@example.com');
    });

    it('strips control characters from the subject, as the server does', () => {
      const email = renderEmail({ subject: 'Hi {{name}}', htmlBody: 'x', textBody: 'x' }, null, {
        name: 'A\tBC',
      });
      expect(email.subject).toBe('Hi ABC');
    });
  });

  describe('validateDraft', () => {
    const valid = { subject: 'Hi {{name}}', htmlBody: '<p>{{name}}</p>', textBody: '{{name}}' };

    it('accepts a valid draft', () => {
      expect(validateDraft(valid, BODY_RULES)).toEqual([]);
    });

    it('requires a single-line, non-empty subject and both bodies', () => {
      const problems = validateDraft({ subject: '', htmlBody: ' ', textBody: '' }, BODY_RULES);
      expect(problems.length).toBe(3);
      expect(validateDraft({ ...valid, subject: 'a\nb' }, BODY_RULES)).toContain('The subject must be a single line.');
    });

    it('refuses script tags', () => {
      expect(validateDraft({ ...valid, htmlBody: '<SCRIPT>x</SCRIPT>' }, BODY_RULES).length).toBe(1);
    });

    it('refuses variables the template does not offer', () => {
      expect(validateDraft({ ...valid, textBody: '{{password}}' }, BODY_RULES)).toEqual([
        "{{password}} isn't available in this template.",
      ]);
    });

    it('reserves triple braces for the layout content slot', () => {
      const problems = validateDraft({ ...valid, htmlBody: '{{{name}}}' }, BODY_RULES);
      expect(problems.some((problem) => problem.startsWith('Triple braces'))).toBeTrue();
    });

    it('requires the layout to contain the content slot exactly once in each body', () => {
      const layout = { subject: '{{subject}}', htmlBody: '{{{content}}}', textBody: '{{{content}}}' };
      expect(validateDraft(layout, LAYOUT_RULES)).toEqual([]);

      const missing = validateDraft({ ...layout, textBody: 'nothing' }, LAYOUT_RULES);
      expect(missing.length).toBe(1);
      expect(missing[0]).toContain('Plain-text body');

      const twice = validateDraft({ ...layout, htmlBody: '{{{content}}}{{{content}}}' }, LAYOUT_RULES);
      expect(twice.length).toBe(1);
    });
  });
});
