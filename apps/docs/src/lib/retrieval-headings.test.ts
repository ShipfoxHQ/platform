import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GLOSSARY_HEADING_PATTERN = /^## (.+)$/gmu;
const STEP_PATTERN = /<Step>([\s\S]*?)<\/Step>/gu;
const STEP_HEADING_PATTERN = /^\s*### (.+)$/gmu;
const glossaryHeadings = [
  'Agent session',
  'Agent step',
  'CEL expressions',
  'Job execution',
  'Feedback loop',
  'Event filter',
  'Gate',
  'Agent harness',
  'Job',
  'Step key',
  'Listening job',
  'AI model',
  'Pipeline terminology',
  'Project',
  'Model provider',
  'Step and job outputs',
  'Run',
  'Runner',
  'Run step',
  'Secret',
  'Workflow step',
  'Thinking level',
  'Workflow trigger',
  'Variable',
  'Workflow',
  'Workspace',
];
const localEvaluationHeadings = [
  'Prepare your machine for local Shipfox evaluation',
  'Install the Shipfox development dependencies',
  'Build the Shipfox API and dashboard packages',
  'Start the Shipfox infrastructure services',
  'Start the Shipfox API and dashboard',
  'Create a local Shipfox account and workspace',
  'Register a local Shipfox runner',
  'Create and fire your first Shipfox workflow',
];

test('gives every glossary term a stable source heading', async () => {
  const source = await readDocsPage('reference/glossary.mdx');
  const headings = [...source.matchAll(GLOSSARY_HEADING_PATTERN)].map((match) => match[1]);

  assert.deepEqual(headings, glossaryHeadings);
});

test('starts every local evaluation step with an action heading', async () => {
  const source = await readDocsPage('installation/local.mdx');
  const steps = [...source.matchAll(STEP_PATTERN)].map((match) => match[1]);
  const headings = [...source.matchAll(STEP_HEADING_PATTERN)].map((match) => match[1]);

  assert.deepEqual(headings, localEvaluationHeadings);
  assert.equal(steps.length, localEvaluationHeadings.length);
  steps.forEach((step, index) => {
    assert.match(
      step.trimStart(),
      new RegExp(`^### ${escapeRegex(localEvaluationHeadings[index])}`),
    );
  });
});

async function readDocsPage(relativePath: string): Promise<string> {
  return await readFile(join(docsRoot, 'content', 'docs', relativePath), 'utf8');
}

function escapeRegex(value: string | undefined): string {
  if (!value) throw new Error('A local evaluation heading is missing.');
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
