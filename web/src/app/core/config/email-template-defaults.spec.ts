import { parseTemplate, renderEmail, validateDraft } from '@core/models/email-template-renderer';
import { EMAIL_LAYOUT_KEY, variablesFor } from '@core/models/email-template.model';

import { EMAIL_TEMPLATE_DEFAULTS } from './email-template-defaults';

/**
 * The shipped templates are what the database is seeded from. One that fails
 * validation could never be saved again once someone edits it, so every default
 * must pass the same rules an edit does.
 */
describe('EMAIL_TEMPLATE_DEFAULTS', () => {
  const layout = EMAIL_TEMPLATE_DEFAULTS.find((template) => template.key === EMAIL_LAYOUT_KEY);

  it('has unique keys and exactly one layout', () => {
    const keys = EMAIL_TEMPLATE_DEFAULTS.map((template) => template.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(EMAIL_TEMPLATE_DEFAULTS.filter((template) => template.category === 'layout').length).toBe(1);
    expect(layout).toBeDefined();
  });

  for (const template of EMAIL_TEMPLATE_DEFAULTS) {
    describe(template.key, () => {
      const variables = variablesFor(template);

      it('passes validation', () => {
        expect(
          validateDraft(template, {
            allowedVariables: variables.map((variable) => variable.name),
            isLayout: template.key === EMAIL_LAYOUT_KEY,
          }),
        ).toEqual([]);
      });

      it('declares every variable with a sample', () => {
        for (const variable of template.variables) {
          expect(variable.sample.trim()).withContext(variable.name).not.toBe('');
          expect(variable.description.trim()).withContext(variable.name).not.toBe('');
        }
      });

      it('renders with sample data leaving no template tags behind', () => {
        const values = Object.fromEntries(variables.map((variable) => [variable.name, variable.sample]));
        const email =
          template.key === EMAIL_LAYOUT_KEY
            ? renderEmail({ subject: 'x', htmlBody: '<p>x</p>', textBody: 'x' }, template, values)
            : renderEmail(template, layout ?? null, values);

        for (const output of [email.subject, email.html, email.text]) {
          expect(output).not.toContain('{{');
          expect(parseTemplate(output).problems).toEqual([]);
        }
        expect(email.html).not.toContain('<script');
      });
    });
  }
});
