import type {InferPageType} from 'fumadocs-core/source';
import {
  assertMachineReadableMarkdown,
  canonicalDocsUrl,
  serializeMachineReadableMarkdown,
} from '@/lib/machine-readable';
import type {source} from '@/lib/source';

const TRAILING_SLASH_PATTERN = /\/$/;
const INTEGRATION_EVENTS_PAGE_PATTERN = /^\/integrations\/[^/]+\/events$/;
const INTEGRATION_TOOLS_PAGE_PATTERN = /^\/integrations\/[^/]+\/tools$/;

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText('processed');
  const description = page.data.description;
  if (typeof description !== 'string' || description.length === 0) {
    const source = page.path ? `${page.path} (${page.url})` : page.url;
    throw new Error(`Documentation page "${source}" is missing a description.`);
  }

  const integrationCatalog = processed.includes('IntegrationCatalog')
    ? (await import('@/lib/integration-catalog-source')).getIntegrationCatalog()
    : undefined;
  const body = serializeMachineReadableMarkdown(processed, {
    integrationCatalog,
    pageUrl: page.url,
    requiredFacts: requiredFactsForPage(page.url),
    sourcePath: page.path,
  });
  const markdown = [
    `# ${page.data.title}`,
    '',
    `Canonical URL: ${canonicalDocsUrl(page.url)}`,
    '',
    `Description: ${description}`,
    '',
    body,
  ].join('\n');

  assertMachineReadableMarkdown(markdown, {
    pageUrl: page.url,
    requiredFacts: requiredFactsForPage(page.url),
    sourcePath: page.path,
  });
  return markdown;
}

function requiredFactsForPage(pageUrl: string): string[] {
  const path = pageUrl.replace(TRAILING_SLASH_PATTERN, '');
  if (path === '/reference/workflow-schema') {
    return ['## Top-level fields', '| `name` |', '## Agent step fields', '| `prompt` |'];
  }
  if (path === '/reference/contexts') {
    return [
      '## Available contexts',
      '| Context | Holds |',
      '## Context properties',
      '| Property | Type | Description |',
    ];
  }
  if (path === '/reference/model-providers') {
    return ['## Supported providers', '| Provider | `provider` ID |'];
  }
  if (path === '/integrations') return ['## Integration catalog', '### GitHub'];
  if (INTEGRATION_EVENTS_PAGE_PATTERN.test(path)) {
    return ['## Event catalog', '### `'];
  }
  if (INTEGRATION_TOOLS_PAGE_PATTERN.test(path)) {
    return ['## Tool catalog', '##### Input'];
  }
  return [];
}
