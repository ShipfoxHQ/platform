import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import handlebars, {type TemplateDelegate} from 'handlebars';
import mjml2html from 'mjml';
import {config} from './config.js';
import {EmailTemplateError} from './errors.js';
import {renderText, type TemplateName, type TemplateVariables} from './text.js';

// `emails/` lives at the package root, sibling to both `src/` and `dist/`, so
// this resolves to the same directory whether the code runs from source
// (dev/test) or from the compiled bundle (prod).
const emailsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'emails');

// The logo asset is served at /email-logo.png by every client composed with
// @shipfox/client-shell (libs/client/shell/assets/email-logo.png), so its URL is
// built from the deployment's CLIENT_BASE_URL and resolved once at module load.
const logoUrl = new URL('/email-logo.png', config.CLIENT_BASE_URL).toString();

// Subjects are plain text, not HTML, so compile them with `noEscape` to keep a
// workspace name like `A&B` from turning into `A&amp;B` in the subject line.
const subjects: Record<TemplateName, string> = {
  'verification-code': 'Your Shipfox verification code',
  'verify-email': 'Verify your email',
  'reset-password': 'Reset your password',
  'workspace-invitation': 'Join {{workspaceName}} on Shipfox',
};

const htmlTemplates = new Map<TemplateName, TemplateDelegate>();
const subjectTemplates = new Map<TemplateName, TemplateDelegate>();

async function getHtmlTemplate(name: TemplateName): Promise<TemplateDelegate> {
  const cached = htmlTemplates.get(name);
  if (cached) return cached;

  const path = join(emailsDir, `${name}.mjml`);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause) {
    throw new EmailTemplateError(name, `Email template file not found: ${path}`, {cause});
  }

  const {html, errors} = await mjml2html(source, {filePath: path, ignoreIncludes: false});
  if (errors.length > 0) {
    throw new EmailTemplateError(
      name,
      `Invalid MJML in template "${name}": ${JSON.stringify(errors)}`,
    );
  }

  const template = handlebars.compile(html);
  htmlTemplates.set(name, template);
  return template;
}

function getSubjectTemplate(name: TemplateName): TemplateDelegate {
  const cached = subjectTemplates.get(name);
  if (cached) return cached;

  const template = handlebars.compile(subjects[name], {noEscape: true});
  subjectTemplates.set(name, template);
  return template;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function sanitizeDisplayValue(value: string): string {
  // Collapse any run of control characters (newlines, tabs, etc.) to a single
  // space and trim. User-controlled display names (workspace, inviter) reach the
  // subject line and the plain-text body, where a raw newline could fold the
  // subject or inject a fake CTA / phishing link as its own line. The boundary
  // schemas reject these names; this is the render-time net for any that slip in.
  return value.replace(/\p{Cc}+/gu, ' ').trim();
}

function sanitizeDisplayValues<Name extends TemplateName>(
  data: TemplateVariables[Name],
): TemplateVariables[Name] {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' ? sanitizeDisplayValue(value) : value,
    ]),
  ) as TemplateVariables[Name];
}

export async function renderEmail<Name extends TemplateName>(
  name: Name,
  data: TemplateVariables[Name],
): Promise<RenderedEmail> {
  const htmlTemplate = await getHtmlTemplate(name);
  const subjectTemplate = getSubjectTemplate(name);
  const safe = sanitizeDisplayValues(data);

  return {
    subject: subjectTemplate(safe),
    html: htmlTemplate({...safe, logoUrl}),
    text: renderText(name, safe),
  };
}
