import assert from 'node:assert/strict';
import test from 'node:test';
import type {CatalogProvider} from './integration-catalog';
import {
  assertMachineReadableMarkdown,
  canonicalDocsUrl,
  canonicalizeDocumentationUrl,
  rewriteMachineReadableLinks,
  serializeMachineReadableMarkdown,
} from './machine-readable';

const github: CatalogProvider = {
  slug: 'github',
  name: 'GitHub',
  summary: 'Connect repositories, receive events, and give agents scoped GitHub tools.',
  capabilities: ['source_control', 'events', 'agent_tools'],
  categories: ['source-control'],
  aliases: ['git', 'vcs'],
  icon: 'github',
  overviewHref: '/integrations/github',
  setupHref: '/integrations/github/setup',
  eventCount: 18,
  toolCount: 21,
};

test('builds canonical documentation URLs independently of the deployment host', () => {
  assert.equal(
    canonicalDocsUrl('/reference/workflow-schema'),
    'https://www.shipfox.io/docs/reference/workflow-schema',
  );
  assert.equal(
    canonicalizeDocumentationUrl('https://shipfox-docs.vercel.app/docs/reference/contexts'),
    'https://www.shipfox.io/docs/reference/contexts',
  );
  assert.equal(
    canonicalizeDocumentationUrl('https://docs.github.com/en/webhooks'),
    'https://docs.github.com/en/webhooks',
  );
  assert.equal(
    canonicalizeDocumentationUrl('../contexts', '/reference/workflow-schema'),
    'https://www.shipfox.io/docs/contexts',
  );
  assert.equal(
    canonicalizeDocumentationUrl('https://www.shipfox.io/changelog'),
    'https://www.shipfox.io/changelog',
  );
  assert.equal(
    canonicalizeDocumentationUrl('https://other-app.vercel.app/reference/contexts'),
    'https://other-app.vercel.app/reference/contexts',
  );
});

test('rewrites documentation links and media while preserving code fences', () => {
  const markdown = [
    '[Workflow schema](/reference/workflow-schema#top-level-fields)',
    '![Deployment topology](/img/diagrams/deployment-topology.png)',
    '[GitHub](https://github.com/ShipfoxHQ/shipfox)',
    '```yaml',
    'url: /reference/workflow-schema',
    '```',
  ].join('\n');

  const rewritten = rewriteMachineReadableLinks(markdown);

  assert.ok(
    rewritten.includes('https://www.shipfox.io/docs/reference/workflow-schema#top-level-fields'),
  );
  assert.ok(rewritten.includes('https://www.shipfox.io/docs/img/diagrams/deployment-topology.png'));
  assert.ok(rewritten.includes('url: /reference/workflow-schema'));
  assert.ok(rewritten.includes('https://github.com/ShipfoxHQ/shipfox'));
  assert.equal(
    rewriteMachineReadableLinks('[Fields](#top-level-fields)', '/reference/workflow-schema'),
    '[Fields](https://www.shipfox.io/docs/reference/workflow-schema#top-level-fields)',
  );

  const fencedMarkers = [
    '~~~yaml',
    '[Inside](/reference/contexts)',
    '```',
    '[Still inside](/reference/workflow-schema)',
    '~~~',
    '[Outside](/reference/contexts)',
  ].join('\n');
  const rewrittenFencedMarkers = rewriteMachineReadableLinks(fencedMarkers);
  assert.ok(rewrittenFencedMarkers.includes('[Still inside](/reference/workflow-schema)'));
  assert.ok(
    rewrittenFencedMarkers.includes('[Outside](https://www.shipfox.io/docs/reference/contexts)'),
  );

  const html = rewriteMachineReadableLinks(
    [
      '<a href="/reference/contexts">Contexts</a>',
      '<img src="/img/diagrams/deployment-topology.png" alt="Topology">',
      '<a href="https://shipfox-docs.vercel.app/docs/reference/contexts">Preview</a>',
    ].join('\n'),
  );
  assert.ok(html.includes('href="https://www.shipfox.io/docs/reference/contexts"'));
  assert.ok(
    html.includes('src="https://www.shipfox.io/docs/img/diagrams/deployment-topology.png"'),
  );
  assert.ok(html.includes('alt="Topology"'));
});

test('serializes integration catalog placeholders as complete Markdown facts', () => {
  const markdown = serializeMachineReadableMarkdown(
    '\0{"name":"IntegrationCatalog","children":"","attributes":{}}\0',
    {
      integrationCatalog: [github],
      requiredFacts: ['## Integration catalog', '### GitHub'],
    },
  );

  assert.ok(markdown.includes('| Slug | `github` |'));
  assert.ok(
    markdown.includes(
      '| Events | 18 ([event catalog](https://www.shipfox.io/docs/integrations/github/events)) |',
    ),
  );
  assert.ok(markdown.includes('| Agent tools | 21'));
  assert.equal(markdown.includes('](/'), false);
});

test('replaces unusable imported image sources with descriptive text', () => {
  const markdown = serializeMachineReadableMarkdown('<img alt="Run detail" src="__img0" />');

  assert.equal(markdown, '[Image: Run detail]');
});

test('fails deterministic checks for unresolved components and links', () => {
  assert.doesNotThrow(() => assertMachineReadableMarkdown('# Test (https://www.shipfox.io/docs)'));
  assert.throws(
    () =>
      serializeMachineReadableMarkdown(
        '\0{"name":"UnknownComponent","children":"","attributes":{}}\0',
      ),
    {
      message:
        'Machine-readable Markdown contains an unresolved component placeholder: UnknownComponent',
    },
  );
  assert.throws(() => assertMachineReadableMarkdown('<TopLevelFields />'), {
    message: 'Machine-readable Markdown contains an unresolved MDX component: <TopLevelFields />',
  });
  assert.throws(() => assertMachineReadableMarkdown('[Contexts](/reference/contexts)'), {
    message: 'Machine-readable Markdown contains a root-relative link or media URL.',
  });
  assert.throws(
    () =>
      assertMachineReadableMarkdown('## Workflow schema', {
        pageUrl: '/reference/workflow-schema',
        requiredFacts: ['| `name` |'],
      }),
    {
      message:
        'Machine-readable Markdown for /reference/workflow-schema is missing generated fact: | `name` |',
    },
  );
  assert.throws(
    () =>
      assertMachineReadableMarkdown('## Contexts', {
        pageUrl: 'https://shipfox-docs.vercel.app/reference/contexts',
      }),
    {
      message:
        'Machine-readable Markdown for https://shipfox-docs.vercel.app/reference/contexts contains a preview or local docs URL.',
    },
  );
  assert.throws(
    () =>
      assertMachineReadableMarkdown('## Changelog', {
        pageUrl: 'https://www.shipfox.io/changelog',
      }),
    {
      message:
        'Machine-readable Markdown for https://www.shipfox.io/changelog contains a non-canonical Shipfox URL.',
    },
  );
});
