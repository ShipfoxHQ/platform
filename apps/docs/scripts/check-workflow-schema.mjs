import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GithubSlugger} from './lib/slug.mjs';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));
const contentRoot = path.join(docsRoot, 'content', 'docs');
const workflowSchemaPage = path.join(contentRoot, 'reference', 'workflow-schema.mdx');
const requiredAnchors = new Set([
  'trigger-fields',
  'step-outputs',
  'job-fields',
  'agent-step-fields',
  'agent-integration-fields',
  'listening-fields',
  'gate-fields',
  'run-step-fields',
  'tool-step-fields',
  'tool-step-outputs',
  'environment-variables',
  'checkout-fields',
]);
const schemaHeader =
  '# yaml-language-server: $schema=https://www.shipfox.io/docs/workflow.schema.json';
const violations = [];

const schemaContent = await readFile(workflowSchemaPage, 'utf8');
const anchors = anchorsFor(schemaContent);
for (const anchor of requiredAnchors) {
  if (!anchors.has(anchor)) violations.push(`workflow-schema.mdx is missing #${anchor}`);
}

for (const file of await filesUnder(contentRoot)) {
  if (!file.endsWith('.mdx')) continue;
  const content = await readFile(file, 'utf8');
  // The optional trailer keeps blocks with code-block meta, such as
  // `title="..."`, inside the check instead of silently skipping them.
  for (const match of content.matchAll(
    /^([ \t]*)```yaml(?:[ \t][^\n]*)?\n([\s\S]*?)^\1```[ \t]*$/gm,
  )) {
    const body = dedent(match[2] ?? '', match[1] ?? '');
    if (!/^(?:name|jobs):/m.test(body)) continue;
    if (!body.startsWith(`${schemaHeader}\n`)) {
      violations.push(
        `${path.relative(docsRoot, file)} has a workflow YAML example without the schema header`,
      );
    }
  }
}

function dedent(content, indentation) {
  if (indentation.length === 0) return content;
  return content
    .split('\n')
    .map((line) => (line.startsWith(indentation) ? line.slice(indentation.length) : line))
    .join('\n');
}

if (violations.length > 0) {
  process.stderr.write(`Workflow schema documentation checks failed:\n${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Workflow schema headings and YAML headers are valid.\n');
}

function anchorsFor(content) {
  const anchors = new Set();
  const slugger = new GithubSlugger();
  for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    if (match[1]) anchors.add(slugger.slug(match[1]));
  }
  return anchors;
}

async function filesUnder(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(file) : [file];
    }),
  );
  return nested.flat();
}
