import {Factory} from 'fishery';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {upsertIntegrationConnection} from '#db/connections.js';

// Mirrors the provider registry's adapter-derived capabilities, so connections
// seeded through the factory carry the same capabilities as their provider.
const FACTORY_PROVIDER_CAPABILITIES: Record<string, IntegrationCapability[]> = {
  github: ['source_control', 'agent_tools'],
  gitea: ['source_control'],
  linear: ['agent_tools'],
  slack: ['agent_tools'],
  jira: ['agent_tools'],
};

export const integrationConnectionFactory = Factory.define<IntegrationConnection>(
  ({sequence, onCreate}) => {
    onCreate((connection) =>
      upsertIntegrationConnection({
        ...connection,
        capabilities: FACTORY_PROVIDER_CAPABILITIES[connection.provider] ?? [],
      }),
    );

    return {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      provider: 'gitea',
      externalAccountId: `gitea-${sequence}`,
      slug: `gitea_${sequence}`,
      displayName: `Gitea Connection ${sequence}`,
      lifecycleStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
