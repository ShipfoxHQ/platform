import assert from 'node:assert/strict';
import {validateIntegrationCatalog} from '@/lib/integration-catalog-validation';

const providers = [
  {
    slug: 'github',
    name: 'GitHub',
    summary: 'Connect repositories and automation.',
    capabilities: ['source_control', 'events', 'agent_tools'],
    categories: ['source-control'],
    aliases: ['git', 'vcs', 'ci'],
    icon: 'github',
    overviewHref: '/integrations/github',
    setupHref: '/integrations/github/setup',
    eventCount: 52,
    toolCount: 24,
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    summary: 'Route error monitoring events.',
    capabilities: ['events'],
    categories: ['observability'],
    aliases: ['errors', 'monitoring', 'crash'],
    icon: 'sentry',
    overviewHref: '/integrations/sentry',
    setupHref: '/integrations/sentry/setup',
    eventCount: 5,
    toolCount: 0,
  },
  {
    slug: 'linear',
    name: 'Linear',
    summary: 'Planned issue tracking integration.',
    capabilities: [],
    categories: ['issue-tracking'],
    aliases: ['issues', 'tickets'],
    icon: 'linear',
    overviewHref: '/integrations/linear',
    setupHref: '/integrations/linear/setup',
    eventCount: 0,
    toolCount: 0,
  },
];

assert.throws(
  () => validateIntegrationCatalog([{...providers[0], eventCount: 0}]),
  /declares events but its event count is 0/,
);
assert.throws(
  () => validateIntegrationCatalog([{...providers[0], toolCount: 0}]),
  /declares agent tools but its tool count is 0/,
);
assert.doesNotThrow(() =>
  validateIntegrationCatalog([
    {
      ...providers[2],
      capabilities: ['events'],
      eventCount: 1,
    },
  ]),
);
assert.throws(
  () => validateIntegrationCatalog([{...providers[0], setupHref: undefined}]),
  /has no setup page/,
);
assert.throws(
  () => validateIntegrationCatalog([providers[1]], {sentry: ['events', 'agent_tools']}),
  /has a agent_tools DTO catalog but omits that capability/,
);
assert.throws(
  () => validateIntegrationCatalog(providers, {unknown: ['events']}),
  /Generated DTO catalog.*no matching provider page/,
);
