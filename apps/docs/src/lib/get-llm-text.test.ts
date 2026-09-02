import assert from 'node:assert/strict';
import test from 'node:test';
import {getLLMText} from './get-llm-text';
import {canonicalDocsUrl} from './machine-readable';

type TestPage = Parameters<typeof getLLMText>[0];
const DESCRIPTION_PATTERN = /\n\nDescription: Test page description\n\n/;

const pages = [
  {
    url: '/reference/workflow-schema',
    body: ['## Top-level fields', '| `name` |', '## Agent step fields', '| `prompt` |'].join('\n'),
  },
  {
    url: '/reference/contexts',
    body: [
      '## Available contexts',
      '| Context | Holds |',
      '## Context properties',
      '| Property | Type | Description |',
    ].join('\n'),
  },
  {
    url: '/reference/model-providers',
    body: ['## Supported providers', '| Provider | `provider` ID |'].join('\n'),
  },
  {
    url: '/integrations/github/events',
    body: ['## Event catalog', '### `push`'].join('\n'),
  },
  {
    url: '/integrations/github/tools',
    body: ['## Tool catalog', '##### Input'].join('\n'),
  },
] as const;

function testPage(url: string, body: string, description = 'Test page description'): TestPage {
  return {
    url,
    data: {
      title: 'Test page',
      description,
      getText: async () => body,
    },
  } as unknown as TestPage;
}

test('applies required generated facts to every reference page family', async () => {
  for (const page of pages) {
    const markdown = await getLLMText(testPage(page.url, page.body));
    assert.equal(markdown.split('\n', 1)[0], `# Test page (${canonicalDocsUrl(page.url)})`);
    assert.match(markdown, DESCRIPTION_PATTERN);
    assert.ok(markdown.includes(page.body));
  }
});

test('reports the source page when description or generated facts are missing', async () => {
  await assert.rejects(getLLMText(testPage('/reference/contexts', '## Available contexts', '')), {
    message: 'Documentation page "/reference/contexts" is missing a description.',
  });
  await assert.rejects(getLLMText(testPage('/reference/workflow-schema', '## Top-level fields')), {
    message:
      'Machine-readable Markdown for /reference/workflow-schema is missing generated fact: | `name` |',
  });
});
