/**
 * Exports the shipped email templates to `docs/email-templates/` for the backend seed.
 *
 *   node web/scripts/export-email-templates.mjs
 *
 * `email-template-defaults.ts` is the source of truth. This bundles it with
 * esbuild (already installed with the Angular CLI) and writes:
 *
 *   email-templates.seed.json   every template, exactly as it should be stored
 *   source/<key>.html|.txt      the same bodies, one file each, for review in a diff
 *   preview/<key>.html          rendered inside the layout with sample data
 */
import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(web, '..', 'docs', 'email-templates');
const bundle = join(web, '.angular', 'export-email-templates.bundle.mjs');

await build({
  stdin: {
    contents: `
      export { EMAIL_TEMPLATE_DEFAULTS } from '@core/config/email-template-defaults';
      export { EMAIL_LAYOUT_KEY, variablesFor } from '@core/models/email-template.model';
      export { renderEmail, validateDraft } from '@core/models/email-template-renderer';
    `,
    resolveDir: join(web, 'src'),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  tsconfig: join(web, 'tsconfig.json'),
  outfile: bundle,
  logLevel: 'error',
});

const { EMAIL_TEMPLATE_DEFAULTS, EMAIL_LAYOUT_KEY, variablesFor, renderEmail, validateDraft } = await import(
  pathToFileURL(bundle).href
);

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'source'), { recursive: true });
await mkdir(join(out, 'preview'), { recursive: true });

const layout = EMAIL_TEMPLATE_DEFAULTS.find((template) => template.key === EMAIL_LAYOUT_KEY);

for (const template of EMAIL_TEMPLATE_DEFAULTS) {
  const variables = variablesFor(template);
  const problems = validateDraft(template, {
    allowedVariables: variables.map((variable) => variable.name),
    isLayout: template.key === EMAIL_LAYOUT_KEY,
  });
  if (problems.length > 0) {
    throw new Error(`${template.key} is invalid:\n  ${problems.join('\n  ')}`);
  }

  const samples = Object.fromEntries(variables.map((variable) => [variable.name, variable.sample]));
  const rendered =
    template.key === EMAIL_LAYOUT_KEY
      ? renderEmail(
          {
            subject: 'Layout preview',
            htmlBody: '<p style="margin:0;font-size:15px;color:#475569;">Each email\'s content appears here.</p>',
            textBody: "Each email's content appears here.",
          },
          template,
          samples,
        )
      : renderEmail(template, layout, samples);

  await writeFile(join(out, 'source', `${template.key}.html`), template.htmlBody);
  await writeFile(join(out, 'source', `${template.key}.txt`), template.textBody);
  await writeFile(join(out, 'preview', `${template.key}.html`), rendered.html);
}

await writeFile(
  join(out, 'email-templates.seed.json'),
  `${JSON.stringify({ version: 1, templates: EMAIL_TEMPLATE_DEFAULTS }, null, 2)}\n`,
);
await rm(bundle, { force: true });

console.log(`Exported ${EMAIL_TEMPLATE_DEFAULTS.length} templates to ${out}`);
