import type {CatalogCapability} from '@/lib/integration-catalog';

interface RegisteredCatalogIntegrationProvider {
  slug: string;
  kind: 'catalog';
  capabilities: readonly CatalogCapability[];
}

interface RegisteredBuiltInSource {
  slug: string;
  kind: 'built-in-source';
  events: readonly string[];
  docRoute: '/reference/trigger-sources';
  anchor: string;
}

export type RegisteredIntegrationProvider =
  | RegisteredCatalogIntegrationProvider
  | RegisteredBuiltInSource;

export const registeredIntegrationProviders: readonly RegisteredIntegrationProvider[] = [
  {
    slug: 'github',
    kind: 'catalog',
    capabilities: ['source_control', 'events', 'agent_tools'],
  },
  {
    slug: 'sentry',
    kind: 'catalog',
    capabilities: ['events'],
  },
  {
    slug: 'webhooks',
    kind: 'catalog',
    capabilities: ['events'],
  },
  {
    slug: 'linear',
    kind: 'catalog',
    capabilities: ['events', 'agent_tools'],
  },
  {
    slug: 'slack',
    kind: 'catalog',
    capabilities: ['events', 'agent_tools'],
  },
  {
    slug: 'jira',
    kind: 'catalog',
    capabilities: ['events', 'agent_tools'],
  },
  {
    slug: 'gitea',
    kind: 'catalog',
    capabilities: ['events'],
  },
  {
    slug: 'cron',
    kind: 'built-in-source',
    events: ['tick'],
    docRoute: '/reference/trigger-sources',
    anchor: 'cron',
  },
];
