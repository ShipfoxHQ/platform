import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  type CatalogProvider,
  countFacetValues,
  emptyCatalogFilters,
  filterProviders,
} from './integration-catalog';

const providers: CatalogProvider[] = [
  {
    slug: 'github',
    name: 'GitHub',
    summary: 'Source control and events',
    capabilities: ['source_control', 'events', 'agent_tools'],
    categories: ['source-control'],
    aliases: ['git'],
    icon: 'github',
    overviewHref: '/integrations/github',
    eventCount: 52,
    toolCount: 21,
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    summary: 'Error events',
    capabilities: ['events'],
    categories: ['observability'],
    aliases: ['monitoring'],
    icon: 'sentry',
    overviewHref: '/integrations/sentry',
    eventCount: 5,
    toolCount: 0,
  },
  {
    slug: 'webhooks',
    name: 'Custom webhook',
    summary: 'Custom events',
    capabilities: ['events'],
    categories: ['custom'],
    aliases: ['http'],
    icon: 'webhooks',
    overviewHref: '/integrations/webhooks',
    eventCount: 1,
    toolCount: 0,
  },
  {
    slug: 'linear',
    name: 'Linear',
    summary: 'Issue tracking',
    capabilities: ['agent_tools'],
    categories: ['issue-tracking'],
    aliases: ['issues'],
    icon: 'linear',
    overviewHref: '/integrations/linear',
    eventCount: 0,
    toolCount: 1,
  },
];

describe('filterProviders', () => {
  it('returns every provider when no filters are selected', () => {
    const filtered = filterProviders(providers, emptyCatalogFilters);

    assert.deepEqual(filtered, providers);
  });

  it('filters providers by query and selected facet groups', () => {
    const filtered = filterProviders(providers, {
      ...emptyCatalogFilters,
      query: 'git',
      capability: ['events'],
      category: ['source-control'],
    });

    assert.deepEqual(
      filtered.map((provider) => provider.slug),
      ['github'],
    );
  });

  it('matches any selected capability within a facet group', () => {
    const filtered = filterProviders(providers, {
      ...emptyCatalogFilters,
      capability: ['events', 'agent_tools'],
    });

    assert.deepEqual(
      filtered.map((provider) => provider.slug),
      ['github', 'sentry', 'webhooks', 'linear'],
    );
  });
});

describe('countFacetValues', () => {
  it('keeps counts disjunctive within a facet group', () => {
    const counts = countFacetValues(providers, {
      ...emptyCatalogFilters,
      capability: ['events'],
      category: ['source-control'],
    });

    assert.deepEqual(counts.capability, {
      source_control: 1,
      events: 1,
      agent_tools: 1,
    });
    assert.deepEqual(counts.category, {
      'source-control': 1,
      observability: 1,
      custom: 1,
      'issue-tracking': 0,
      messaging: 0,
    });
  });
});
