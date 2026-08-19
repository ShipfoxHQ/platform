import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {CatalogFilters, CatalogProvider} from './integration-catalog';
import {
  catalogFilterChangedProperties,
  catalogResultClickedProperties,
  catalogSearchProperties,
} from './integration-catalog-analytics';

const providers: CatalogProvider[] = [
  {
    slug: 'github',
    name: 'GitHub',
    summary: 'Source control',
    capabilities: ['source_control', 'events'],
    categories: ['source-control'],
    aliases: ['git'],
    icon: 'github',
    overviewHref: '/integrations/github',
    setupHref: '/integrations/github/setup',
    eventCount: 1,
    toolCount: 1,
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
    eventCount: 1,
    toolCount: 0,
  },
];

describe('catalog analytics properties', () => {
  it('builds a settled search payload with selected filters', () => {
    const filters: CatalogFilters = {
      query: ' GitHub ',
      capability: ['events'],
      category: ['source-control'],
    };

    const properties = catalogSearchProperties(filters, 1);

    assert.deepEqual(properties, {
      query: 'github',
      query_length: 6,
      query_redacted: false,
      selected_capabilities: ['events'],
      selected_categories: ['source-control'],
      result_count: 1,
      has_results: true,
    });
  });

  it('reports the result count after a filter change', () => {
    const filters: CatalogFilters = {
      query: '',
      capability: [],
      category: ['observability'],
    };

    const properties = catalogFilterChangedProperties(providers, filters, {
      facet: 'category',
      value: 'observability',
      action: 'selected',
    });

    assert.equal(properties.result_count, 1);
    assert.equal(properties.action, 'selected');
  });

  it('reports the clicked target and rendered result rank', () => {
    const filters: CatalogFilters = {query: '', capability: ['events'], category: []};

    const properties = catalogResultClickedProperties(filters, providers, providers[1], 'setup');

    assert.equal(properties.provider, 'sentry');
    assert.equal(properties.target, 'setup');
    assert.equal(properties.result_rank, 2);
    assert.equal(properties.result_count, 2);
  });
});
